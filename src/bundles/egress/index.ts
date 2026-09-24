import { Context, Service } from 'cordis'
import { MemoryConsentStore } from './store.js'
import { EgressError, type ConsentRecord, type ConsentStore } from './types.js'

export * from './types.js'
export { FileConsentStore, MemoryConsentStore } from './store.js'

export interface EgressConfig {
  /**
   * Required. Consent is tracked per project, never globally — a project
   * with no record sends nothing, whatever any other setting says (D-029).
   */
  projectId: string
  /** Where consent decisions persist. Default: in-memory (lost on restart). */
  consentStore?: ConsentStore
  /** Hostnames a remote call may reach. Empty (default) allows none. */
  allowedHosts?: string[]
  /** Named secret values to strip from any outbound payload before it is sent or logged. */
  secrets?: Record<string, string>
}

declare module 'cordis' {
  interface Context {
    egress: EgressPolicy
  }
}

/**
 * `ctx.egress` — 1B.1. This is the mandatory gate in front of any call that
 * leaves the machine: per-project consent (persisted, opt-in, never on by
 * default), an endpoint allowlist, and redaction of known secret values.
 *
 * This bundle is booted unconditionally by every profile, `profile-minimal`
 * included (D-029) — it is not a config toggle on `bundle-model-adapter`,
 * it is a dependency `bundle-model-adapter` cannot start without
 * (`LLMService.static inject` includes `'egress'`). "Guardrails are
 * disableable in profile-minimal" (D-006) covers `policy-gates` only;
 * egress controls are structural, not a runtime flag a sub-agent could flip.
 *
 * Not a full "secrets proxy" in the sense of holding provider API keys —
 * those already never enter this pipeline (a provider's key lives in its
 * own private config, added to the request only at the HTTP layer inside
 * `send()`, never part of `CompletionRequest`/`ProviderRequest`, so it was
 * already structurally excluded from the session log and any prompt before
 * this bundle existed - see D-022). What this bundle adds is redaction of
 * *other* secrets that could ride along inside message content or tool
 * output (a seeded fake credential in a file being read, for example):
 * register the value once, and it is scrubbed from every outbound payload
 * and every session-log entry built from that payload, by construction.
 */
export class EgressPolicy extends Service {
  private readonly projectId: string
  private readonly store: ConsentStore
  private readonly allowedHosts: Set<string>
  private readonly secrets: Map<string, string>

  constructor(ctx: Context, config: EgressConfig) {
    super(ctx, 'egress')
    if (!config?.projectId) {
      throw new EgressError('config', 'egress: `projectId` is required - consent is tracked per project, not globally')
    }
    this.projectId = config.projectId
    this.store = config.consentStore ?? new MemoryConsentStore()
    this.allowedHosts = new Set(config.allowedHosts ?? [])
    this.secrets = new Map(Object.entries(config.secrets ?? {}).filter(([, v]) => !!v))
  }

  /** Add a secret value to redact. A no-op for an empty/undefined value (nothing to match). */
  registerSecret(name: string, value: string | undefined): void {
    if (value) this.secrets.set(name, value)
  }

  /** Replace every occurrence of every registered secret value with `[redacted:<name>]`. */
  redact(text: string): string {
    let out = text
    for (const [name, value] of this.secrets) out = out.split(value).join(`[redacted:${name}]`)
    return out
  }

  /** Recursively redact every string leaf of a JSON-shaped value. Used on outbound request bodies. */
  redactValue<T>(value: T): T {
    if (typeof value === 'string') return this.redact(value) as unknown as T
    if (Array.isArray(value)) return value.map((v) => this.redactValue(v)) as unknown as T
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.redactValue(v)])) as unknown as T
    }
    return value
  }

  async hasConsent(): Promise<boolean> {
    const record = await this.store.get(this.projectId)
    return record?.consented === true
  }

  async grantConsent(): Promise<ConsentRecord> {
    const record: ConsentRecord = { projectId: this.projectId, consented: true, decidedAt: new Date().toISOString() }
    await this.store.set(record)
    return record
  }

  async revokeConsent(): Promise<ConsentRecord> {
    const record: ConsentRecord = { projectId: this.projectId, consented: false, decidedAt: new Date().toISOString() }
    await this.store.set(record)
    return record
  }

  isAllowedHost(host: string): boolean {
    return this.allowedHosts.has(host)
  }

  /** Throws `EgressError('endpoint', ...)` if `host` is not on the allowlist. */
  assertAllowedHost(host: string): void {
    if (!this.isAllowedHost(host)) {
      const known = [...this.allowedHosts].join(', ') || 'none'
      throw new EgressError('endpoint', `egress: host "${host}" is not in the allowlist for project "${this.projectId}". Allowed: ${known}.`)
    }
  }
}

export const name = 'bundle-egress'
export function apply(ctx: Context, config: EgressConfig) {
  ctx.plugin(EgressPolicy, config)
}
