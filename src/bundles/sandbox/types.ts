export type SandboxErrorKind = 'unknown-provider' | 'config' | 'unreachable' | 'lease' | 'consent'

export class SandboxError extends Error {
  override name = 'SandboxError'
  constructor(public kind: SandboxErrorKind, message: string) {
    super(message)
  }
}

export interface SandboxRunRequest {
  /** argv, no shell. A provider that must go through a shell quotes it itself. */
  command: string[]
  /** Which registered provider. Default: the one registered as default. */
  provider?: string
  timeoutMs?: number
  signal?: AbortSignal
}

export interface SandboxRunResult {
  provider: string
  /** The lease / sandbox id this run used. */
  leaseId: string
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
  /** True only when the lease was confirmed gone afterwards. `false` means a lease MAY be leaked: see `releaseNote`. */
  released: boolean
  releaseNote?: string
  /** Time from "create" to "ready", when the provider can measure it (cubesandbox). */
  bootMs?: number
}

export interface SandboxDoctor {
  ok: boolean
  detail: string
}

export interface SandboxProvider {
  readonly name: string
  /** `remote` = a second data destination (D-024): it needs egress consent and an allowlisted host before it runs. */
  readonly destination: 'local' | 'remote'
  /** Hostname the remote destination is reached at, checked against the egress allowlist. Required when remote. */
  readonly host?: string
  run(req: SandboxRunRequest): Promise<SandboxRunResult>
  doctor(): Promise<SandboxDoctor>
}

/** One row of `ctx.sandbox.status()`, for `doctor` and the consent screen. Never contains credentials. */
export interface SandboxStatus {
  name: string
  destination: 'local' | 'remote'
  host?: string
  default: boolean
}
