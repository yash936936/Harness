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

async function waitForWorkers(children: ChildProcess[], count: number, type: 'ready' | 'result'): Promise<WorkerMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: WorkerMessage[] = []
    const seen = new Set<ChildProcess>()
    const timeout = setTimeout(() => reject(new Error(`reservation benchmark timed out waiting for worker ${type}`)), 30_000)
    const finish = () => {
      if (seen.size !== count) return
      clearTimeout(timeout)
      resolve(messages)
    }
    for (const child of children) {
      child.on('message', (raw: unknown) => {
        const message = raw as WorkerMessage
        if (!message || message.type !== type || seen.has(child)) return
        seen.add(child)
        messages.push(message)
        finish()
      })
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', (code) => {
        if (code !== 0 && seen.size !== count) {
          clearTimeout(timeout)
          reject(new Error(`reservation benchmark worker exited with code ${code}`))
        }
      })
    }
  })
}

async function runRound(processCount: number, root: string, sample: number) {
  const statePath = join(root, `reservation-state-${processCount}-${sample}.json`)
  const seed = new Budgets({ requests: { day: { hard: HARD_LIMIT } }, statePath })
  seed.record('requests', 0)
  const started = performance.now()
  const children = Array.from({ length: processCount }, () => fork(fileURLToPath(import.meta.url), [], {
    execArgv: process.execArgv,
    env: {
      ...process.env,
      HARNESS_RESERVATION_BENCH_WORKER: '1',
      HARNESS_RESERVATION_BENCH_STATE: statePath,
    },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  }))
  try {
    await waitForWorkers(children, processCount, 'ready')
    const startupMs = performance.now() - started
    const contentionStarted = performance.now()
    for (const child of children) child.send({ type: 'go' })
    const results = await waitForWorkers(children, processCount, 'result')
    const contentionMs = performance.now() - contentionStarted
    const accepted = results.filter((message) => message.type === 'result' && message.accepted).length
    const rejected = results.length - accepted
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
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `\\n## Independent-process reservation baseline\\n\\n\\`\\`\\`json\\n${output}\\n\\`\\`\\`\\n`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
