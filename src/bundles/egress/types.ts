/** A project's decision on whether anything may leave this machine for it. */
export interface ConsentRecord {
  projectId: string
  consented: boolean
  /** ISO-8601 timestamp of the decision. */
  decidedAt: string
}

/**
 * Persists consent decisions, keyed by project. A project with no record —
 * first run, or one that was never asked — has `hasConsent()` return
 * `false`; there is no "consented by default" state.
 */
export interface ConsentStore {
  get(projectId: string): Promise<ConsentRecord | undefined>
  set(record: ConsentRecord): Promise<void>
}

/** Read-only snapshot for `doctor` (1B.2). Never mutates anything - a pure read of current state. */
export interface EgressStatus {
  projectId: string
  consented: boolean
  /** Absent when there is no consent record at all (never asked), as opposed to a recorded "no". */
  decidedAt?: string
  allowedHosts: string[]
}

export type EgressErrorKind = 'consent' | 'endpoint' | 'config'

export class EgressError extends Error {
  override name = 'EgressError'
  constructor(
    public kind: EgressErrorKind,
    message: string,
  ) {
    super(message)
  }
}
