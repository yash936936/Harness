import { performance } from 'node:perf_hooks'
import { VercelSandboxProvider, type VercelSandboxClient } from '../src/bundles/sandbox-vercel/index.js'

const SAMPLES = 3
const OUTPUT_LIMIT_BYTES = 100_000
const OUTPUT_SIZES = [99_000, 100_000, 1_000_000, 8_000_000]
const MARKER = '\n[output truncated by Vercel provider]'

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

async function runSample(outputChars: number, sample: number) {
  let peakRss = process.memoryUsage().rss
  const rssBefore = peakRss
  const observe = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss) }
  const client: VercelSandboxClient = {
    async create() {
      return {
        name: `output-baseline-${outputChars}-${sample}`,
        async runCommand() {
          return {
            async *logs() {
              const chunk = 64 * 1024
              for (let sent = 0; sent < outputChars; sent += chunk) {
                const size = Math.min(chunk, outputChars - sent)
                yield { stream: 'stdout' as const, data: Buffer.alloc(size, 0x78).toString('utf8') }
                yield { stream: 'stderr' as const, data: Buffer.alloc(size, 0x79).toString('utf8') }
                observe()
              }
            },
            async wait() { return { exitCode: 0 } },
          }
        },
        async delete() {},
      }
    },
  }
  const provider = new VercelSandboxProvider({ client, maxOutputBytes: OUTPUT_LIMIT_BYTES })
  const monitor = setInterval(observe, 5)
  try {
    const started = performance.now()
    const result = await provider.run({ command: ['emit-output'], timeoutMs: 30_000 })
    const elapsedMs = performance.now() - started
    observe()
    const expectedLength = Math.min(outputChars, OUTPUT_LIMIT_BYTES) + (outputChars > OUTPUT_LIMIT_BYTES ? MARKER.length : 0)
    if (result.stdout.length !== expectedLength || result.stderr.length !== expectedLength || !result.released) {
      throw new Error(`unexpected output result for ${outputChars} chars: ${JSON.stringify({ stdout: result.stdout.length, stderr: result.stderr.length, released: result.released })}`)
    }
    return {
      sample,
      sourceCharsPerStream: outputChars,
      sourceBytesBothStreams: outputChars * 2,
      returnedBytesPerStream: Buffer.byteLength(result.stdout),
      elapsedMs: Number(elapsedMs.toFixed(3)),
      peakRssDeltaBytes: Math.max(0, peakRss - rssBefore),
      stdoutTruncated: result.stdout.includes(MARKER),
      stderrTruncated: result.stderr.includes(MARKER),
      released: result.released,
    }
  } finally {
    clearInterval(monitor)
  }
}

const results = []
for (const size of OUTPUT_SIZES) {
  const samples = []
  for (let sample = 0; sample < SAMPLES; sample++) samples.push(await runSample(size, sample))
  results.push({
    sourceCharsPerStream: size,
    elapsedMs: stats(samples.map((s) => s.elapsedMs)),
    peakRssDeltaBytes: stats(samples.map((s) => s.peakRssDeltaBytes)),
    returnedBytesPerStream: samples.map((s) => s.returnedBytesPerStream),
    truncation: samples.map((s) => ({ stdout: s.stdoutTruncated, stderr: s.stderrTruncated })),
    samples,
  })
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
    outputLimitBytesPerStream: OUTPUT_LIMIT_BYTES,
    sourceSizesCharsPerStream: OUTPUT_SIZES,
    samplesPerSize: SAMPLES,
    streams: 2,
    provider: 'VercelSandboxProvider with injected in-process fake client; no cloud request',
    timing: 'provider.run including detached command log iteration, bounded per-stream capture, and cleanup',
    memory: 'process RSS sampled every 5 ms while fake provider yields 64 KiB chunks without materializing complete stream strings; process-wide and may miss transient allocation peaks',
    streaming: 'The adapter consumes the SDK detached command logs async iterator and retains no more than outputLimitBytes per stream. The fake validates adapter behavior only; live Vercel acceptance remains separate.',
  },
  results,
  interpretation: 'The fake emits bounded chunks through the same async log interface as the SDK. Captured output stays within the configured per-stream byte limit plus the explicit truncation marker.',
}
const output = JSON.stringify(report, null, 2)
console.log(output)
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFile } = await import('node:fs/promises')
  await appendFile(process.env.GITHUB_STEP_SUMMARY, ['', '## Output capture baseline', '', '```json', output, '```', ''].join('\n'))
}
