import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Context } from 'cordis'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { Embeddings, HashingEmbeddingProvider } from '../src/bundles/embeddings/index.js'
import { LanceVectorStore } from '../src/bundles/vectorstore-lancedb/index.js'
import { MemorySemantic, type SemanticFact } from '../src/bundles/memory/index.js'

const SAMPLES = 3
const FACTS = 2_000
const EMBEDDING_BATCH_SIZE = 64

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

function makeFacts(): SemanticFact[] {
  const ts = '2026-11-14T00:00:00.000Z'
  return Array.from({ length: FACTS }, (_, i) => ({
    tier: 'semantic' as const,
    id: `semantic-benchmark-${String(i).padStart(5, '0')}`,
    text: `Architecture fact ${i}: module ${i % 37} owns durable state and validates operation ${i % 113} before committing record ${i}.`,
    why: 'Generated benchmark fixture for measuring semantic reindex resource use.',
    tags: [`module-${i % 37}`, `operation-${i % 113}`],
    ts,
  }))
}

async function runSample(root: string, sample: number) {
  const dataDir = join(root, `facts-${sample}`)
  const dbDir = join(root, `vectors-${sample}`)
  await mkdir(dataDir, { recursive: true })
  await writeFile(join(dataDir, 'semantic.json'), JSON.stringify(makeFacts()), { encoding: 'utf8', mode: 0o600 })

  const ctx = new Context()
  const fibers: Array<{ dispose(): Promise<unknown> | unknown }> = []
  const batchSizes: number[] = []
  const inner = new HashingEmbeddingProvider({ dimensions: 64 })
  let peakRss = process.memoryUsage().rss
  const rssBefore = peakRss
  const observe = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss) }
  const monitor = setInterval(observe, 5)
  try {
    fibers.push(await ctx.plugin(EgressPolicy, { projectId: 'semantic-benchmark' }))
    fibers.push(await ctx.plugin(Embeddings, { maxBatchSize: EMBEDDING_BATCH_SIZE }))
    ctx.embeddings.register({
      name: inner.name,
      model: inner.model,
      egress: inner.egress,
      embed: async (texts) => {
        batchSizes.push(texts.length)
        return inner.embed(texts)
      },
    })
    fibers.push(await ctx.plugin(LanceVectorStore, { path: dbDir }))
    fibers.push(await ctx.plugin(MemorySemantic, { path: dataDir }))

    await import('@lancedb/lancedb')
    observe()
    const started = performance.now()
    const result = await ctx.memorySemantic.reindex({ reset: true })
    const elapsedMs = performance.now() - started
    observe()
    if (!result.ok) throw new Error(`semantic reindex failed: ${result.error.kind}: ${result.error.detail}`)
    if (result.indexed !== FACTS) throw new Error(`expected ${FACTS} facts, indexed ${result.indexed}`)

    const info = ctx.embeddings.info()
    if (!info?.fingerprint || !info.dimensions) throw new Error('embedding fingerprint unavailable after reindex')
    const opened = await ctx.vectorstore.open('memory-semantic', { fingerprint: info.fingerprint, dimensions: info.dimensions })
    if (!opened.ok) throw new Error(`cannot inspect semantic collection: ${opened.error.kind}: ${opened.error.detail}`)
    const count = await opened.collection.count()
    if (!count.ok || count.count !== FACTS) throw new Error(`expected ${FACTS} vectors, got ${count.ok ? count.count : count.error.detail}`)

    return {
      sample,
      facts: result.indexed,
      vectors: count.count,
      elapsedMs: Number(elapsedMs.toFixed(3)),
      factsPerSecond: Number((result.indexed / (elapsedMs / 1000)).toFixed(1)),
      embeddingRequests: batchSizes.length,
      embeddingBatchSizes: batchSizes,
      vectorUpserts: 1,
      rssBeforeBytes: rssBefore,
      peakRssBytes: peakRss,
      peakRssDeltaBytes: Math.max(0, peakRss - rssBefore),
    }
  } finally {
    clearInterval(monitor)
    for (const fiber of fibers.reverse()) await fiber.dispose()
  }
}

const root = await mkdtemp(join(tmpdir(), 'harness-semantic-reindex-baseline-'))
try {
  await import('@lancedb/lancedb')
  const samples = []
  for (let sample = 0; sample < SAMPLES; sample++) samples.push(await runSample(root, sample))
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
      facts: FACTS,
      embeddingBatchSize: EMBEDDING_BATCH_SIZE,
      samples: SAMPLES,
      provider: 'deterministic local hashing embeddings (not a semantic-quality benchmark)',
      timing: 'MemorySemantic.reindex({ reset: true }); fixture generation and LanceDB module loading are outside the timed interval',
      memory: 'process RSS sampled every 5 ms during setup and reindex; process-wide, includes setup, and can miss short-lived peaks',
      batching: 'Embeddings batches provider calls, but MemorySemantic builds all text inputs and vectors and submits all vector records in one collection upsert',
    },
    results: {
      elapsedMs: stats(samples.map((s) => s.elapsedMs)),
      factsPerSecond: stats(samples.map((s) => s.factsPerSecond)),
      peakRssDeltaBytes: stats(samples.map((s) => s.peakRssDeltaBytes)),
      embeddingRequests: samples.map((s) => s.embeddingRequests),
      embeddingBatchSizes: samples.map((s) => s.embeddingBatchSizes),
      vectorUpserts: samples.map((s) => s.vectorUpserts),
      indexedFacts: samples.map((s) => s.facts),
      indexedVectors: samples.map((s) => s.vectors),
      samples,
    },
    interpretation: 'This is a baseline of the current all-at-once semantic reindex path. Provider calls are batched, but the complete fact text list, returned vectors, and vector record list remain materialized before one upsert. It does not measure a resumable or bounded-memory reindex implementation.',
  }
  const output = JSON.stringify(report, null, 2)
  console.log(output)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises')
    await appendFile(process.env.GITHUB_STEP_SUMMARY, ['', '## Semantic reindex baseline', '', '```json', output, '```', ''].join('\n'))
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
