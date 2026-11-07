import { SandboxError, type SandboxDoctor, type SandboxProvider, type SandboxRunRequest, type SandboxRunResult } from '../sandbox/types.js'

/** The minimum of an E2B-compatible client this provider needs. Tests inject a fake; production uses the `e2b` package. */
export interface CubeSandboxHandle {
  id: string
  run(command: string, opts: { timeoutMs?: number }): Promise<{ exitCode: number | null; stdout: string; stderr: string }>
  kill(): Promise<void>
}
export interface CubeClient {
  create(opts: { template: string; timeoutMs: number }): Promise<CubeSandboxHandle>
}

export interface CubeSandboxConfig {
  /** Base URL of the CubeAPI (E2B-compatible). Its hostname is what egress checks. */
  apiUrl: string
  apiKey?: string
  /** Template id or alias (must be READY on the Cube host). */
  template: string
  /** Injected client. Default: the `e2b` package, imported lazily (install it with `npm i e2b` on the machine that uses this). */
  client?: CubeClient
  /** Boot-to-ready budget in ms. The provider claims <60 ms; a boot slower than this is flagged in `releaseNote`-style output, not failed. Default 200. */
  bootBudgetMs?: number
  /** Sandbox lifetime cap in ms. Default 300000. */
  sandboxTimeoutMs?: number
}

/** POSIX single-quote each argv element so the E2B command string runs it as one argv. */
export function shellQuote(argv: string[]): string {
  return argv.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('aborted'))
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => { cleanup(); reject(signal.reason ?? new Error('aborted')) }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    promise.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
  })
}

async function defaultClient(cfg: CubeSandboxConfig): Promise<CubeClient> {
  let mod: any
  try {
    mod = await import('e2b' as string)
  } catch {
    throw new SandboxError('config', 'cubesandbox: the "e2b" package is not installed. Run `npm i e2b`, or inject a client in the config.')
  }
  const Sandbox = mod.Sandbox ?? mod.default?.Sandbox
  return {
    async create({ template, timeoutMs }) {
      const sb = await Sandbox.create(template, { apiKey: cfg.apiKey, apiUrl: cfg.apiUrl, timeoutMs })
      return {
        id: String(sb.sandboxId ?? sb.id),
        async run(command, o) {
          try {
            const r = await sb.commands.run(command, { timeoutMs: o.timeoutMs })
            return { exitCode: r.exitCode ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
          } catch (e: any) {
            // The E2B SDK throws on a non-zero exit; the result is on the error.
            if (typeof e?.exitCode === 'number') return { exitCode: e.exitCode, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
            throw e
          }
        },
        async kill() {
          await sb.kill()
        },
      }
    },
  }
}

/**
 * `ctx.sandbox` provider `cubesandbox` (5.2). One call = create a VM sandbox, run the command, kill it in a `finally`.
 * `bootMs` is the measured create time. UNVERIFIED against a real CubeSandbox (needs an x86_64 Linux KVM host, D-024):
 * the lifecycle is tested with an injected fake client; the default `e2b` wiring, the boot budget and the isolation
 * claim are checked by `scripts/smoke-cubesandbox.ts` on such a host.
 */
export class CubeSandboxProvider implements SandboxProvider {
  readonly name = 'cubesandbox'
  readonly destination = 'remote' as const
  readonly host: string
  private client: CubeClient | undefined

  constructor(private readonly cfg: CubeSandboxConfig) {
    let api: URL
    try {
      api = new URL(cfg.apiUrl)
    } catch {
      throw new SandboxError('config', `cubesandbox: apiUrl "${cfg.apiUrl}" is not a valid URL`)
    }
    this.host = api.hostname
    if (api.protocol !== 'https:') throw new SandboxError('config', 'cubesandbox: apiUrl must use HTTPS')
    if (!this.host || api.username || api.password || api.search || api.hash) throw new SandboxError('config', 'cubesandbox: apiUrl must have a hostname and must not contain credentials, query or fragment')
    if (typeof cfg.template !== 'string' || !cfg.template.trim() || cfg.template.length > 256) throw new SandboxError('config', 'cubesandbox: template must be a non-empty id of at most 256 characters')
    if (cfg.apiKey !== undefined && (typeof cfg.apiKey !== 'string' || !cfg.apiKey.trim())) throw new SandboxError('config', 'cubesandbox: apiKey must be a non-empty string when supplied')
    if (cfg.bootBudgetMs !== undefined && (!Number.isSafeInteger(cfg.bootBudgetMs) || cfg.bootBudgetMs < 1)) throw new SandboxError('config', 'cubesandbox: bootBudgetMs must be a positive safe integer')
    if (cfg.sandboxTimeoutMs !== undefined && (!Number.isSafeInteger(cfg.sandboxTimeoutMs) || cfg.sandboxTimeoutMs < 1)) throw new SandboxError('config', 'cubesandbox: sandboxTimeoutMs must be a positive safe integer')
    if (cfg.client !== undefined && (typeof cfg.client.create !== 'function')) throw new SandboxError('config', 'cubesandbox: client must implement create')
    this.client = cfg.client
  }

  private async getClient(): Promise<CubeClient> {
    return (this.client ??= await defaultClient(this.cfg))
  }

  async doctor(): Promise<SandboxDoctor> {
    try {
      const r = await this.run({ command: ['true'], timeoutMs: 30_000 })
      const budget = this.cfg.bootBudgetMs ?? 200
      return { ok: r.released && r.exitCode === 0, detail: `booted in ${r.bootMs}ms (budget ${budget}ms)${r.released ? '' : '; sandbox may not have been killed'}` }
    } catch (e: any) {
      return { ok: false, detail: String(e?.message ?? e).slice(0, 200) }
    }
  }

  async run(req: SandboxRunRequest): Promise<SandboxRunResult> {
    req.signal?.throwIfAborted()
    const start = Date.now()
    const client = await raceAbort(this.getClient(), req.signal)
    let create: Promise<CubeSandboxHandle> | undefined
    let handle: CubeSandboxHandle
    try {
      create = Promise.resolve(client.create({ template: this.cfg.template, timeoutMs: this.cfg.sandboxTimeoutMs ?? 300_000 }))
      handle = await raceAbort(create, req.signal)
    } catch (error: any) {
      if (req.signal?.aborted) {
        // The SDK create call has no cancellation parameter. If it completes after
        // the caller aborts, kill the late handle instead of leaving a remote VM.
        if (create) void create.then((late) => late.kill()).catch(() => {})
        throw req.signal.reason ?? error
      }
      throw new SandboxError('unreachable', `cubesandbox: could not create a sandbox (${String(error?.message ?? error).slice(0, 300)})`)
    }
    if (!handle || typeof handle.kill !== 'function') {
      throw new SandboxError('unreachable', 'cubesandbox: client returned a handle without a kill function')
    }
    if (typeof handle.id !== 'string' || !handle.id || typeof handle.run !== 'function') {
      await Promise.resolve().then(() => handle.kill()).catch(() => {})
      throw new SandboxError('unreachable', 'cubesandbox: client returned an invalid sandbox handle')
    }
    const bootMs = Date.now() - start
    let out = { exitCode: null as number | null, stdout: '', stderr: '' }
    let timedOut = false
    let rel: { released: boolean; note?: string }
    try {
      const result = await raceAbort(handle.run(shellQuote(req.command), { timeoutMs: req.timeoutMs }), req.signal)
      if (!result || (result.exitCode !== null && !Number.isSafeInteger(result.exitCode)) ||
          typeof result.stdout !== 'string' || typeof result.stderr !== 'string') {
        throw new Error('cubesandbox: client returned a malformed command result')
      }
      out = result
    } catch (error: any) {
      if (req.signal?.aborted) throw req.signal.reason ?? error
      const msg = String(error?.message ?? error)
      timedOut = /timeout|timed out/i.test(msg)
      out = { exitCode: null, stdout: '', stderr: msg.slice(0, 500) }
    } finally {
      try {
        await handle.kill()
        rel = { released: true }
      } catch (error: any) {
        rel = { released: false, note: `kill failed: ${String(error?.message ?? error).slice(0, 160)}` }
      }
    }
    const budget = this.cfg.bootBudgetMs ?? 200
    return {
      provider: this.name,
      leaseId: handle.id,
      ...out,
      timedOut,
      durationMs: Date.now() - start,
      released: rel.released,
      releaseNote: rel.note ?? (bootMs > budget ? `slow boot: ${bootMs}ms exceeds the ${budget}ms budget` : undefined),
      bootMs,
    }
  }
}
