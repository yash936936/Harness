import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { SemanticFactStore } from '../src/bundles/memory/semantic-store.js'
import type { SemanticFact } from '../src/bundles/memory/types.js'

const FACTS = 100_000
const DELETIONS = 25_000
const SAMPLES = 3
const PAGE_SIZE = 50
const CURSORS = [49_999, 89_999, 99_899]

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0
}

function stats(values: number[]) {
  return {
    p50: Number(percentile(values, 0.5).toFixed(3)),
    p95: Number(percentile(values, 0.95).toFixed(3)),
    samples: values.length,
  }
}

function fact(id: number, revision = 0): SemanticFact {
  const key = String(id).padStart(6, '0')
  return {
    tier: 'semantic',
    id: `fact-${key}`,
    text: `architecture fact ${key} revision ${revision}`,
    why: `deterministic large-store pagination fixture ${key}`,
    ts: '2026-01-01T00:00:00.000Z',
    ...(revision ? { updatedTs: '2026-01-02T00:00:00.000Z' } : {}),
  }
}

async function runSample(root: string, sample: number) {
  const dir = join(root, `sample-${sample}`)
  await mkdir(dir, { recursive: true })
  const source = [
    ...Array.from({ length: FACTS }, (_, id) => JSON.stringify({ op: 'put', fact: fact(id) })),
    ...Array.from({ length: DELETIONS }, (_, id) => JSON.stringify({ op: 'delete', id: fact(id).id })),
    JSON.stringify({ op: 'put', fact: fact(0, 1) }),
  ].join('\n') + '\n'
  await writeFile(join(dir, 'semantic.events.jsonl'), source, { encoding: 'utf8', mode: 0o600 })
  const sourceBytes = (await stat(join(dir, 'semantic.events.jsonl'))).size
  const store = new SemanticFactStore(dir)
  const rssBefore = process.memoryUsage().rss
  let peakRss = rssBefore
  const monitor = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss) }, 5)
  try {
    const buildStarted = performance.now()
    const last = await store.get(fact(FACTS - 1).id)
    const indexBuildMs = performance.now() - buildStarted
    if (!last) throw new Error('index build failed to recover the final semantic fact')
    const revision = await store.revision()
    const liveCount = await store.count()
    if (liveCount !== FACTS - DELETIONS + 1) throw new Error(`expected ${FACTS - DELETIONS + 1} live facts, got ${liveCount}`)

    const pageResults: Record<string, { timings: number[]; firstId: string; lastId: string }> = {}
    for (const cursor of CURSORS) {
      const cursorId = fact(cursor).id
      const timings: number[] = []
      let firstId = ''
      let lastId = ''
      for (let repeat = 0; repeat < 5; repeat++) {
        const started = performance.now()
        const page = await store.page(cursorId, PAGE_SIZE, revision)
        timings.push(performance.now() - started)
        firstId ||= page.items[0]?.id ?? ''
        lastId = page.items.at(-1)?.id ?? ''
        if (page.items.length !== PAGE_SIZE) throw new Error(`cursor ${cursorId}: expected ${PAGE_SIZE} rows, got ${page.items.length}`)
      }
      pageResults[String(cursor)] = { timings, firstId, lastId }
    }
    const tail = await store.page(fact(FACTS - 1).id, 1, revision)
    if (tail.items[0]?.id !== fact(0, 1).id) throw new Error('deleted-and-reinserted fact was not moved to the end')

    return {
      sample,
      factsWritten: FACTS + DELETIONS + 1,
      factsDeleted: DELETIONS,
      liveFacts: liveCount,
      sourceBytes,
      indexBytes: (await stat(join(dir, 'semantic.index.jsonl'))).size,
      indexBuildMs: Number(indexBuildMs.toFixed(3)),
      pageResults: Object.fromEntries(Object.entries(pageResults).map(([cursor, value]) => [cursor, {
        ...stats(value.timings),
        timings: value.timings,
        firstId: value.firstId,
        lastId: value.lastId,
      }])),
      rssBeforeBytes: rssBefore,
      peakRssBytes: peakRss,
      peakRssDeltaBytes: Math.max(0, peakRss - rssBefore),
    }
  } finally {
    clearInterval(monitor)
  }
}

const root = await mkdtemp(join(tmpdir(), 'harness-semantic-page-baseline-'))
type SampleResult = Awaited<ReturnType<typeof runSample>>
try {
  const samples: SampleResult[] = []
  for (let sample = 0; sample < SAMPLES; sample++) samples.push(await runSample(root, sample))
  const pageStats = Object.fromEntries(CURSORS.map((cursor) => {
    const values = samples.flatMap((sample) => {
      const entry = sample.pageResults[String(cursor)] as { timings: number[] }
      return entry.timings
    })
    return [String(cursor), stats(values)]
  }))
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
      factsWritten: FACTS,
      deletes: DELETIONS,
      reinsertions: 1,
      liveFacts: FACTS - DELETIONS + 1,
      pageSize: PAGE_SIZE,
      cursorPositions: CURSORS,
      tailCursorPosition: FACTS - 1,
      samples: SAMPLES,
      warmPageRepeatsPerCursorPerSample: 5,
      memory: 'process RSS sampled every 5 ms during index build and warm page reads; process-wide and may miss short-lived peaks',
      timing: 'index build includes sidecar rebuild on a prewritten event log; warm page timings exclude fixture creation and index build',
    },
    results: {
      indexBuildMs: stats(samples.map((sample) => sample.indexBuildMs)),
      peakRssDeltaBytes: stats(samples.map((sample) => sample.peakRssDeltaBytes)),
      warmPageMsByCursor: pageStats,
      sourceBytes: samples.map((sample) => sample.sourceBytes),
      indexBytes: samples.map((sample) => sample.indexBytes),
      samples,
    },
    interpretation: 'This measures persistent semantic index rebuild and indexed warm keyset pages on a 100k-event store with 25k deletes and one delete/reinsert. Warm pages use a cursor near the beginning, middle, and end. RSS is process-wide and sampled; three samples are not a stable tail estimate. It does not measure embedding quality or claim constant-memory identity indexing.',
  }
  const output = JSON.stringify(report, null, 2)
  console.log(output)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises')
    await appendFile(process.env.GITHUB_STEP_SUMMARY, ['', '## Semantic keyset page baseline', '', '```json', output, '```', ''].join('\n'))
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
