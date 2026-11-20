import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { JsonlStore } from '../src/bundles/session-log/store.js'
import { JsonlEpisodeStore } from '../src/bundles/memory/store.js'
import { EpisodicMemory } from '../src/bundles/memory/episodic.js'
import type { SessionEvent } from '../src/bundles/session-log/index.js'
import type { Episode } from '../src/bundles/memory/types.js'

const COUNTS = [0, 50_000, 100_000]
const SAMPLES = 5
const root = await mkdtemp(join(tmpdir(), 'harness-architecture-baseline-'))
const rssStart = process.memoryUsage().rss
let peakRss = rssStart

function observeRss() {
  peakRss = Math.max(peakRss, process.memoryUsage().rss)
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0
}

function stats(values: number[]) {
  return {
    p50Ms: Number(percentile(values, 0.50).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    samples: values.length,
  }
}

function sessionEvent(seq: number): SessionEvent {
  return {
    seq,
    ts: '2026-01-01T00:00:00.000Z',
    sessionId: 'baseline-session',
    type: 'tool.result',
    data: { tool: 'read_file', result: 'x'.repeat(120) },
  }
}

function episode(index: number): Episode {
  return {
    id: `session-${Math.floor(index / 10)}:${index + 1}`,
    sessionId: `session-${Math.floor(index / 10)}`,
    agentId: 'main',
    ts: '2026-01-01T00:00:00.000Z',
    task: index % 100 === 0 ? 'selective-target task' : `ordinary task ${index}`,
    approach: 'search_code -> read_file',
    result: 'completed',
    outcome: 'done',
    lesson: null,
    fromSeq: index + 1,
    toSeq: index + 2,
    steps: 2,
    toolCalls: 2,
  }
}

const sessionFixture = Array.from({ length: 100_000 }, (_, i) => JSON.stringify(sessionEvent(i + 1))).join('\n') + '\n'
const episodeFixture = Array.from({ length: 100_000 }, (_, i) => JSON.stringify(episode(i))).join('\n') + '\n'
const sessionTemplate = join(root, 'session-template.jsonl')
const episodeTemplate = join(root, 'episode-template.jsonl')
await writeFile(sessionTemplate, sessionFixture, { encoding: 'utf8', mode: 0o600 })
await writeFile(episodeTemplate, episodeFixture, { encoding: 'utf8', mode: 0o600 })

const results: Record<string, unknown> = {}
try {
  for (const count of COUNTS) {
    const timings: number[] = []
    const warmTimings: number[] = []
    let fixtureBytes = 0
    for (let sample = 0; sample < SAMPLES; sample++) {
      const dir = join(root, `session-${count}-${sample}`)
      await mkdir(dir)
      const file = join(dir, 'baseline-session.jsonl')
      if (count > 0) {
        const prefix = sessionFixture.split('\n').slice(0, count).join('\n') + '\n'
        await writeFile(file, prefix, { encoding: 'utf8', mode: 0o600 })
      } else {
        await writeFile(file, '', { encoding: 'utf8', mode: 0o600 })
      }
      const store = new JsonlStore(dir)
      fixtureBytes = (await readFile(file)).byteLength
      const started = performance.now()
      await store.withLock('baseline-session', async () => {
        const last = await store.lastSeq('baseline-session')
        await store.append(sessionEvent(last + 1))
      })
      timings.push(performance.now() - started)
      for (let warm = 0; warm < SAMPLES; warm++) {
        const warmStarted = performance.now()
        await store.withLock('baseline-session', async () => {
          const last = await store.lastSeq('baseline-session')
          await store.append(sessionEvent(last + 1))
        })
        warmTimings.push(performance.now() - warmStarted)
      }
      observeRss()
    }
    results[`sessionLogAppendAt${count}`] = { ...stats(timings), fixtureBytes, estimatedFullFileReadBytesPerAppend: fixtureBytes }
    results[`sessionLogWarmAppendAt${count}`] = { ...stats(warmTimings), fixtureBytes, estimatedFullFileReadBytesPerAppend: 0 }
  }

  for (const count of [100_000]) {
    const identityBuildTimings: number[] = []
    const duplicateTimings: number[] = []
    const lookupTimings: number[] = []
    const queryTimings: number[] = []
    let fixtureBytes = 0
    let identityIndexBytes = 0
    let identityManifestBytes = 0
    for (let sample = 0; sample < SAMPLES; sample++) {
      const dir = join(root, `memory-${count}-${sample}`)
      await mkdir(dir)
      const file = join(dir, 'episodic.jsonl')
      await copyFile(episodeTemplate, file)
      fixtureBytes = Buffer.byteLength(await (await import('node:fs/promises')).readFile(file))
      const store = new JsonlEpisodeStore(dir)
      const duplicate = episode(50_000)
      let started = performance.now()
      const indexed = await store.findById(duplicate.id)
      identityBuildTimings.push(performance.now() - started)
      if (!indexed) throw new Error('identity index build/lookup did not find the expected episode')
      started = performance.now()
      const created = await store.add(duplicate)
      duplicateTimings.push(performance.now() - started)
      if (created) throw new Error('duplicate benchmark fixture was not recognized')
      started = performance.now()
      const found = await store.findById(duplicate.id)
      lookupTimings.push(performance.now() - started)
      if (!found) throw new Error('warm indexed lookup did not find the expected episode')
      identityIndexBytes = (await stat(join(dir, 'episodic.index.jsonl'))).size
      identityManifestBytes = (await stat(join(dir, 'episodic.index.meta.json'))).size

      const ctx = {
        egress: { redactValue: <T>(value: T): T => value },
      } as any
      const memory = new EpisodicMemory(store, ctx, 2000, () => new Date('2026-01-01T00:00:00.000Z'))
      started = performance.now()
      const hits = await memory.query({ task: 'selective-target', limit: 20 })
      queryTimings.push(performance.now() - started)
      if (hits.length !== 20) throw new Error(`selective query correctness failed: expected 20, got ${hits.length}`)
      observeRss()
    }
    results.episodicIdentityIndexBuildAt100k = { ...stats(identityBuildTimings), fixtureBytes, identityIndexBytes, identityManifestBytes, sourceLogScannedOnceToBuild: true }
    results.episodicDuplicateCheckAt100k = {
      ...stats(duplicateTimings),
      fixtureBytes,
      identityIndexBytes,
      estimatedFullFileReadBytesPerWarmCheck: 0,
    }
    results.episodicFindByIdAt100k = { ...stats(lookupTimings), fixtureBytes, identityIndexBytes, estimatedFullFileReadBytesPerWarmLookup: 0 }
    results.episodicSelectiveQueryAt100k = {
      ...stats(queryTimings),
      fixtureBytes,
      estimatedFullFileReadBytesPerQuery: fixtureBytes,
      expectedHits: 20,
    }
  }

  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: (await import('node:os')).cpus().length,
      totalMemoryBytes: (await import('node:os')).totalmem(),
    },
    fixture: { sessionEvents: 100_000, episodes: 100_000, samplesPerMeasurement: SAMPLES },
    memory: { rssStartBytes: rssStart, peakObservedRssBytes: peakRss, observedRssDeltaBytes: Math.max(0, peakRss - rssStart) },
    results,
    notMeasured: {
      reservations: 'The separate reservation baseline measures the legacy process-local implementation as a negative control. Shared SQLite acceptance is not measurable until a transactional SQLite provider exists.',
      indexing: 'Measured separately by architecture-indexing-baseline.ts with a deterministic project tree and local hashing embeddings; the project-wide prepared chunk list remains in memory.',
      output: 'Measured separately by architecture-output-capture-baseline.ts using detached command log iteration and bounded fake chunks; live Vercel provider acceptance remains unverified.',
      semanticReindex: 'Measured separately by architecture-semantic-reindex-baseline.ts with deterministic embeddings; semantic facts are read in bounded pages and durable source-version checkpoints allow restart.',
    },
  }
  console.log(JSON.stringify(report, null, 2))
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises')
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n## Architecture performance baseline\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`)
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
