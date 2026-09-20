/** One immutable entry in a session's append-only log. */
export interface SessionEvent {
  /** Monotonic per-session sequence number, starting at 1. */
  seq: number
  /** ISO-8601 timestamp assigned at append time. */
  ts: string
  sessionId: string
  /**
   * Dotted event type, e.g. `model.input`, `model.output`, `tool.call`,
   * `tool.result`, `policy.reject`, `approval.pending`, `approval.resolved`.
   * Kept an open string so later bundles can add types without touching this one.
   */
  type: string
  /** Optional emitter (agent id, bundle name). */
  actor?: string
  /** JSON-serialisable payload. */
  data: unknown
}

/** Written as the first event of a forked session. */
export interface ForkOrigin {
  fromSession: string
  atSeq: number
}

/** Storage backend. Implementations must be append-only. */
export interface SessionStore {
  append(event: SessionEvent): Promise<void>
  read(sessionId: string): Promise<SessionEvent[]>
  list(): Promise<string[]>
}
