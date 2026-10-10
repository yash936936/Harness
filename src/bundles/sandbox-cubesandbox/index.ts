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
    try {
      this.host = new URL(cfg.apiUrl).hostname
    } catch {
      throw new SandboxError('config', `cubesandbox: apiUrl "${cfg.apiUrl}" is not a valid URL`)
    }
    if (!this.host) throw new SandboxError('config', 'cubesandbox: apiUrl has no hostname')
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
    const client = await this.getClient()
    const start = Date.now()
    let handle: CubeSandboxHandle
    try {
      handle = await client.create({ template: this.cfg.template, timeoutMs: this.cfg.sandboxTimeoutMs ?? 300_000 })
    } catch (e: any) {
      throw new SandboxError('unreachable', `cubesandbox: could not create a sandbox (${String(e?.message ?? e).slice(0, 300)})`)
    }
    const bootMs = Date.now() - start
    let out = { exitCode: null as number | null, stdout: '', stderr: '' }
    let timedOut = false
    let rel: { released: boolean; note?: string }
    try {
      out = await handle.run(shellQuote(req.command), { timeoutMs: req.timeoutMs })
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      timedOut = /timeout|timed out/i.test(msg)
      out = { exitCode: null, stdout: '', stderr: msg.slice(0, 500) }
    } finally {
      rel = await handle.kill().then(
        () => ({ released: true } as { released: boolean; note?: string }),
        (e: any) => ({ released: false, note: `kill failed: ${String(e?.message ?? e).slice(0, 160)}` }),
      )
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
