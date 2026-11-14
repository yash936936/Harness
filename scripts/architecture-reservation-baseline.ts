import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fork, type ChildProcess } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { Budgets } from '../src/bundles/app-core/budgets.js'

const WORKER = process.env.HARNESS_RESERVATION_BENCH_WORKER === '1'
const HARD_LIMIT = 1
const SAMPLES = 5
const PROCESS_COUNTS = [2, 4, 8] as const

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'result'; accepted: boolean; error?: string }

function workerMain(): void {
  const statePath = process.env.HARNESS_RESERVATION_BENCH_STATE
  if (!statePath) throw new Error('reservation benchmark worker is missing its state path')
  const budgets = new Budgets({
    requests: { day: { hard: HARD_LIMIT } },
    statePath,
  })
  process.send?.({ type: 'ready' })
  process.on('message', (message: unknown) => {
    if (!message || typeof message !== 'object' || (message as { type?: unknown }).type !== 'go') return
    let accepted = false
    let error: string | undefined
    try {
      void budgets.reserve('requests', 1)
      accepted = true
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
    const result: WorkerMessage = { type: 'result', accepted, ...(error ? { error } : {}) }
    if (process.send) process.send(result, () => process.exit(0))
    else process.exit(1)
  })
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0
}

function stats(values: number[]) {
  return {
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    samples: values.length,
  }
}

async function runRound(processCount: number, root: string, sample: number) {
  const statePath = join(root, `reservation-state-${processCount}-${sample}.json`)
  const seed = new Budgets({ requests: { day: { hard: HARD_LIMIT } }, statePath })
  seed.record('requests', 0)
  const started = performance.now()
  const ready = new Set<ChildProcess>()
  const results: WorkerMessage[] = []
  let resolveReady!: () => void
  let resolveResults!: (messages: WorkerMessage[]) => void
  let rejectFailure!: (error: Error) => void
  const readyPromise = new Promise<void>((resolve) => { resolveReady = resolve })
  const resultsPromise = new Promise<WorkerMessage[]>((resolve) => { resolveResults = resolve })
  const failurePromise = new Promise<never>((_resolve, reject) => { rejectFailure = reject })
  const children = Array.from({ length: processCount }, () => {
    const child = fork(fileURLToPath(import.meta.url), [], {
      execArgv: process.execArgv,
      env: {
        ...process.env,
        HARNESS_RESERVATION_BENCH_WORKER: '1',
        HARNESS_RESERVATION_BENCH_STATE: statePath,
      },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    })
    child.on('message', (raw: unknown) => {
      const message = raw as WorkerMessage
      if (message?.type === 'ready') {
        ready.add(child)
        if (ready.size === processCount) resolveReady()
      } else if (message?.type === 'result') {
        results.push(message)
        if (results.length === processCount) resolveResults(results)
      }
    })
    child.once('error', rejectFailure)
    child.once('exit', (code) => {
      if (code !== 0 && results.length !== processCount) {
        rejectFailure(new Error(`reservation benchmark worker exited with code ${code}`))
      }
    })
    return child
  })
  const timeout = setTimeout(() => rejectFailure(new Error('reservation benchmark worker timed out')), 30_000)
  try {
    await Promise.race([readyPromise, failurePromise])
    const startupMs = performance.now() - started
    const contentionStarted = performance.now()
    for (const child of children) child.send({ type: 'go' })
    const messages = await Promise.race([resultsPromise, failurePromise])
    const contentionMs = performance.now() - contentionStarted
    const accepted = messages.filter((message) => message.type === 'result' && message.accepted).length
    const rejected = messages.length - accepted
    return {
      processCount,
      accepted,
      rejected,
      hardLimit: HARD_LIMIT,
      oversubscription: Math.max(0, accepted - HARD_LIMIT),
      startupMs: Number(startupMs.toFixed(3)),
      contentionMs: Number(contentionMs.toFixed(3)),
    }
  } finally {
    clearTimeout(timeout)
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill()
    }
  }
}

if (WORKER) {
  workerMain()
} else {
  const root = await mkdtemp(join(tmpdir(), 'harness-reservation-baseline-'))
  try {
    const results: Record<string, unknown> = {}
    for (const processCount of PROCESS_COUNTS) {
      const samples = []
      for (let sample = 0; sample < SAMPLES; sample++) {
        samples.push(await runRound(processCount, root, sample))
      }
      results[`processes-${processCount}`] = {
        acceptedP50: Number(percentile(samples.map((sample) => sample.accepted), 0.5).toFixed(3)),
        rejectedP50: Number(percentile(samples.map((sample) => sample.rejected), 0.5).toFixed(3)),
        oversubscriptionP50: Number(percentile(samples.map((sample) => sample.oversubscription), 0.5).toFixed(3)),
        startup: stats(samples.map((sample) => sample.startupMs)),
        contention: stats(samples.map((sample) => sample.contentionMs)),
        samples,
      }
    }
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpus: (await import('node:os')).cpus().length,
      },
      workload: {
        hardLimit: HARD_LIMIT,
        processes: PROCESS_COUNTS,
        samplesPerProcessCount: SAMPLES,
        synchronization: 'All independent workers load the same persisted day-state file, then reserve simultaneously after a parent barrier.',
      },
      interpretation: 'The current Budgets.reserve implementation holds reservations only in process memory and does not persist them. This baseline intentionally measures the resulting independent-process oversubscription; it is not a shared transactional reservation benchmark.',
      results,
    }
    const output = JSON.stringify(report, null, 2)
    console.log(output)
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFile } = await import('node:fs/promises')
      await appendFile(process.env.GITHUB_STEP_SUMMARY, ['', '## Independent-process reservation baseline', '', '\`\`\`json', output, '\`\`\`', ''].join('\\n'))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
