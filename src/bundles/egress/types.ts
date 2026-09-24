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
