import { Context, Service } from 'cordis'
import { SandboxError, type SandboxProvider, type SandboxRunRequest, type SandboxRunResult, type SandboxStatus } from './types.js'

export * from './types.js'

declare module 'cordis' {
  interface Context {
    sandbox: Sandbox
  }
}

/**
 * `ctx.sandbox` — the seam for isolated execution (5.1, 5.2). Providers register on it; nothing here knows how a
 * lease works. It enforces the one rule that belongs to the seam: a REMOTE provider is a second data destination
 * (D-024), so it does not run unless this project has egress consent AND the provider's host is on the egress
 * allowlist. Local providers need neither. Every run is checked here, not trusted to the provider.
 */
export class Sandbox extends Service {
  static inject = ['egress']
  private readonly providers = new Map<string, SandboxProvider>()
  private defaultName: string | undefined

  constructor(ctx: Context) {
    super(ctx, 'sandbox')
  }

  register(provider: SandboxProvider, opts: { default?: boolean } = {}): void {
    if (this.providers.has(provider.name)) throw new SandboxError('config', `sandbox: provider "${provider.name}" is already registered`)
    if (provider.destination === 'remote' && !provider.host) {
      throw new SandboxError('config', `sandbox: remote provider "${provider.name}" must declare the host it reaches, so egress can allowlist it`)
    }
    this.providers.set(provider.name, provider)
    if (opts.default || this.defaultName === undefined) this.defaultName = provider.name
  }

  has(name: string): boolean {
    return this.providers.has(name)
  }

  status(): SandboxStatus[] {
    return [...this.providers.values()].map((p) => ({ name: p.name, destination: p.destination, host: p.host, default: p.name === this.defaultName }))
  }

  async doctor(): Promise<Record<string, { ok: boolean; detail: string }>> {
    const out: Record<string, { ok: boolean; detail: string }> = {}
    for (const [n, p] of this.providers) {
      try {
        out[n] = await p.doctor()
      } catch (e: any) {
        out[n] = { ok: false, detail: String(e?.message ?? e) }
      }
    }
    return out
  }

  async run(req: SandboxRunRequest): Promise<SandboxRunResult> {
    const name = req.provider ?? this.defaultName
    const p = name ? this.providers.get(name) : undefined
    if (!p) {
      const known = [...this.providers.keys()].join(', ') || 'none'
      throw new SandboxError('unknown-provider', `sandbox: no provider "${name ?? '(default)'}". Registered: ${known}.`)
    }
    if (!Array.isArray(req.command) || req.command.length === 0 || req.command.some((a) => typeof a !== 'string')) {
      throw new SandboxError('config', 'sandbox: command must be a non-empty array of strings')
    }
    if (p.destination === 'remote') {
      const st = await this.ctx.egress.status()
      if (!st.consented) throw new SandboxError('consent', `sandbox: "${p.name}" is a remote destination and this project has not consented to sending data off the machine`)
      this.ctx.egress.assertAllowedHost(p.host!)
    }
    return p.run(req)
  }
}

export const name = 'bundle-sandbox'
export function apply(ctx: Context) {
  ctx.plugin(Sandbox)
}
