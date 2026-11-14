import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Context } from 'cordis'
import { Embeddings, HashingEmbeddingProvider } from '../src/bundles/embeddings/index.js'
import { RetrievalGrep } from '../src/bundles/retrieval-grep/index.js'
import { RetrievalRank } from '../src/bundles/retrieval-rank/index.js'
import { RetrievalTreesitter } from '../src/bundles/retrieval-treesitter/index.js'
import { Subprocess } from '../src/bundles/subprocess/index.js'
import { LanceVectorStore } from '../src/bundles/vectorstore-lancedb/index.js'

const SAMPLES = 3
const ORDINARY_FILES = 30
const FUNCTIONS_PER_FILE = 40
const LARGE_FILE_FUNCTIONS = 540
const INDEX_GROUP_CHUNKS = 512

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

function source(prefix: string, count: number): string {
  const lines: string[] = []
  for (let i = 0; i < count; i++) {
    lines.push(
      `export function ${prefix}Function${i}(value: number): number {`,
      `  const adjusted = value + ${i + 1}`,
      '  return adjusted * 2',
      '}',
      '',
    )
  }
  return lines.join('\n')
}

async function createFixture(root: string): Promise<string[]> {
  const files: string[] = []
  for (let i = 0; i < ORDINARY_FILES; i++) {
    const rel = `src/module-${String(i).padStart(2, '0')}.ts`
    const absolute = join(root, rel)
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(absolute, source(`module${i}`, FUNCTIONS_PER_FILE), { mode: 0o600 })
    files.push(rel)
  }
  const large = 'src/large-generated.ts'
  await writeFile(join(root, large), source('large', LARGE_FILE_FUNCTIONS), { mode: 0o600 })
  files.push(large)
  return files
}

async function runSample(root: string, sample: number) {
  const project = join(root, `project-${sample}`)
  const db = join(root, `vectors-${sample}`)
  await mkdir(project, { recursive: true })
  const files = await createFixture(project)
  const ctx = new Context()
  const fibers: Array<{ dispose(): Promise<unknown> | unknown }> = []
  let calls = 0
  let peakRss = process.memoryUsage().rss
  const rssBefore = peakRss
  const observe = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss) }
  const monitor = setInterval(observe, 5)
  try {
    fibers.push(await ctx.plugin(Subprocess))
    fibers.push(await ctx.plugin(RetrievalGrep, { root: project }))
    fibers.push(await ctx.plugin(RetrievalTreesitter, { maxSymbols: 2000 }))
    fibers.push(await ctx.plugin(Embeddings, { maxBatchSize: 512 }))
    const inner = new HashingEmbeddingProvider({ dimensions: 64 })
    ctx.embeddings.register({
      name: inner.name,
      model: inner.model,
      egress: inner.egress,
      embed: async (texts) => {
        calls++
        return inner.embed(texts)
      },
    })
    fibers.push(await ctx.plugin(LanceVectorStore, { path: db }))
    fibers.push(await ctx.plugin(RetrievalRank, { root: project, indexGroupChunks: INDEX_GROUP_CHUNKS }))

    // Load parser/WASM and LanceDB before starting the timed indexing operation.
    const warm = await ctx.retrievalParse.parse('export function warmup() { return 1 }', { filename: 'warmup.ts' })
    if (!warm.ok) throw new Error(`tree-sitter warmup failed: ${warm.error.kind}`)
    await import('@lancedb/lancedb')
    observe()
    calls = 0
    const started = performance.now()
    const result = await ctx.retrievalRank.indexFiles(files, { reset: true })
    const elapsedMs = performance.now() - started
    observe()
    if (!result.ok) throw new Error(`indexing failed: ${result.error.kind}: ${result.error.detail}`)
    if (result.chunks <= LARGE_FILE_FUNCTIONS || result.embeddedChunks !== result.chunks) {
      throw new Error(`fixture did not index expected chunks: ${JSON.stringify(result)}`)
    }
    return {
      sample,
      files: result.files,
      chunks: result.chunks,
      embeddedChunks: result.embeddedChunks,
      embeddingCalls: calls,
      elapsedMs: Number(elapsedMs.toFixed(3)),
      chunksPerSecond: Number((result.chunks / (elapsedMs / 1000)).toFixed(1)),
      rssBeforeBytes: rssBefore,
      peakRssBytes: peakRss,
      peakRssDeltaBytes: Math.max(0, peakRss - rssBefore),
      largeFileExpectedChunks: LARGE_FILE_FUNCTIONS,
      indexGroupChunks: INDEX_GROUP_CHUNKS,
    }
  } finally {
    clearInterval(monitor)
    for (const fiber of fibers.reverse()) await fiber.dispose()
  }
}

const root = await mkdtemp(join(tmpdir(), 'harness-indexing-baseline-'))
try {
  // Warm native dependencies outside the samples so elapsed times focus on indexing.
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
      ordinaryFiles: ORDINARY_FILES,
      functionsPerOrdinaryFile: FUNCTIONS_PER_FILE,
      largeFileFunctions: LARGE_FILE_FUNCTIONS,
      expectedMinimumChunks: ORDINARY_FILES * FUNCTIONS_PER_FILE + LARGE_FILE_FUNCTIONS,
      indexGroupChunks: INDEX_GROUP_CHUNKS,
      samples: SAMPLES,
      provider: 'deterministic local hashing embeddings (not a semantic-quality benchmark)',
      timing: 'indexFiles only; fixture creation, parser/WASM warmup, and LanceDB module loading are outside the timed interval',
      memory: 'process RSS sampled every 5 ms during setup and indexing; delta is process-wide and can miss short-lived peaks',
    },
    results: {
      elapsedMs: stats(samples.map((s) => s.elapsedMs)),
      chunksPerSecond: stats(samples.map((s) => s.chunksPerSecond)),
      peakRssDeltaBytes: stats(samples.map((s) => s.peakRssDeltaBytes)),
      embeddingCalls: samples.map((s) => s.embeddingCalls),
      indexedFiles: samples.map((s) => s.files),
      indexedChunks: samples.map((s) => s.chunks),
      samples,
    },
    interpretation: 'The current indexFiles implementation prepares all readable files and their chunks before embedding groups. indexGroupChunks bounds each embedding group, not total prepared chunk memory. This benchmark captures current behavior and does not claim bounded-memory indexing.',
  }
  const output = JSON.stringify(report, null, 2)
  console.log(output)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises')
    await appendFile(process.env.GITHUB_STEP_SUMMARY, ['', '## Indexing baseline', '', '```json', output, '```', ''].join('\n'))
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
