import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Context } from 'cordis'
import { RetrievalGrep } from '../src/bundles/retrieval-grep/index.js'
import { RetrievalRank } from '../src/bundles/retrieval-rank/index.js'
import { RetrievalTreesitter } from '../src/bundles/retrieval-treesitter/index.js'
import { Subprocess } from '../src/bundles/subprocess/index.js'

const SOURCE_BYTES = 12 * 1024 * 1024
const LINE_BYTES = 64
const LINES = SOURCE_BYTES / LINE_BYTES
const SAMPLES = 5
const QUERY = 'needle'

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

function createFixture(root: string): void {
  const fd = openSync(join(root, 'large-retrieval.txt'), 'w', 0o600)
  const block = Buffer.alloc(64 * 1024, 0x78)
  for (let offset = LINE_BYTES - 1; offset < block.length; offset += LINE_BYTES) block[offset] = 0x0a
  block.write(QUERY, 0, 'utf8')
  block[QUERY.length] = 0x20 // Keep the query as a standalone token for BM25.
  try {
    for (let written = 0; written < SOURCE_BYTES; written += block.length) writeSync(fd, block)
  } finally {
    closeSync(fd)
  }
}

type Memory = { rss: number; heapUsed: number; external: number; arrayBuffers: number }
function memory(): Memory {
  const usage = process.memoryUsage()
  return { rss: usage.rss, heapUsed: usage.heapUsed, external: usage.external, arrayBuffers: usage.arrayBuffers }
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'harness-retrieval-memory-'))
  try {
    createFixture(root)
    const ctx = new Context()
    await ctx.plugin(Subprocess)
    await ctx.plugin(RetrievalGrep, { root, maxResults: 20, maxMatchesPerFile: 5 })
    await ctx.plugin(RetrievalTreesitter)
    await ctx.plugin(RetrievalRank, {
      root,
      weight: 0,
      maxFileBytes: 16 * 1024 * 1024,
      maxLinesPerFile: 200_000,
      maxChunksPerFile: 5_000,
      maxCandidateChunks: 5_000,
    })

    const samples: Array<{
      sample: number
      elapsedMs: number
      candidateFiles: number
      candidateChunks: number
      hits: number
      baseline: Memory
      peak: Memory
      delta: Memory
    }> = []

    for (let sample = 0; sample < SAMPLES; sample++) {
      const baseline = memory()
      const peak = { ...baseline }
      const observe = () => {
        const current = memory()
        peak.rss = Math.max(peak.rss, current.rss)
        peak.heapUsed = Math.max(peak.heapUsed, current.heapUsed)
        peak.external = Math.max(peak.external, current.external)
        peak.arrayBuffers = Math.max(peak.arrayBuffers, current.arrayBuffers)
      }
      const monitor = setInterval(observe, 1)
      try {
        const started = performance.now()
        const result = await ctx.retrievalRank.search(QUERY, { k: 10, weight: 0 })
        const elapsedMs = performance.now() - started
        observe()
        if (!result.ok) throw new Error(`retrieval search failed: ${result.error.kind}: ${result.error.detail}`)
        if (result.stats.candidateFiles !== 1 || result.stats.candidateChunks < 4_000 || result.hits.length === 0) {
          throw new Error(`unexpected large-file retrieval result: ${JSON.stringify({ stats: result.stats, hits: result.hits.length })}`)
        }
        samples.push({
          sample,
          elapsedMs: Number(elapsedMs.toFixed(3)),
          candidateFiles: result.stats.candidateFiles,
          candidateChunks: result.stats.candidateChunks,
          hits: result.hits.length,
          baseline,
          peak,
          delta: {
            rss: Math.max(0, peak.rss - baseline.rss),
            heapUsed: Math.max(0, peak.heapUsed - baseline.heapUsed),
            external: Math.max(0, peak.external - baseline.external),
            arrayBuffers: Math.max(0, peak.arrayBuffers - baseline.arrayBuffers),
          },
        })
      } finally {
        clearInterval(monitor)
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
        sourceBytes: SOURCE_BYTES,
        lineBytes: LINE_BYTES,
        lines: LINES,
        files: 1,
        matchingLines: 1,
        samples: SAMPLES,
        query: QUERY,
        mode: 'lexical BM25; embeddings disabled',
        configuredLimits: {
          maxFileBytes: 16 * 1024 * 1024,
          maxLinesPerFile: 200_000,
          maxChunksPerFile: 5_000,
          maxCandidateChunks: 5_000,
        },
        memory: 'process RSS, V8 heapUsed, external and arrayBuffers sampled every 1 ms during rank.search; deltas are process-wide and sampling can miss short-lived peaks',
        timing: 'end-to-end RetrievalRank.search including ripgrep, bounded file read, line/chunk preparation, tokenization and BM25 scoring; fixture creation excluded',
      },
      results: {
        elapsedMs: stats(samples.map((sample) => sample.elapsedMs)),
        candidateChunks: samples.map((sample) => sample.candidateChunks),
        peakDeltaBytes: {
          rss: stats(samples.map((sample) => sample.delta.rss)),
          heapUsed: stats(samples.map((sample) => sample.delta.heapUsed)),
          external: stats(samples.map((sample) => sample.delta.external)),
          arrayBuffers: stats(samples.map((sample) => sample.delta.arrayBuffers)),
        },
        samples,
      },
      interpretation: 'This is a reproducible single-file worst-case retrieval workload near the configured 16 MiB per-file ceiling. It measures the current lexical search path, not semantic vector retrieval, concurrent searches, or a strict allocation peak. Five samples are descriptive, not a stable tail estimate.',
    }
    const output = JSON.stringify(report, null, 2)
    console.log(output)
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFile } = await import('node:fs/promises')
      await appendFile(process.env.GITHUB_STEP_SUMMARY, ['', '## Large-file retrieval memory baseline', '', '```json', output, '```', ''].join('\n'))
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

await main()
