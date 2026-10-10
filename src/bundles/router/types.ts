/** The three decisions D-026 gives the router. Content-bearing calls and policy decisions are NOT here: they stay with the worker and the deterministic gates. */
export type DecisionClass = 'agent' | 'playbook' | 'tool'
export const DECISION_CLASSES: readonly DecisionClass[] = ['agent', 'playbook', 'tool']

export interface Candidate {
  id: string
  description: string
  /** `tool` class only: true for read-only or allowlisted tools. A candidate without it is never offered to the router. */
  allowed?: boolean
}

export interface RouteRequest {
  task: string
  candidates: Candidate[]
  /** Session to record this decision in (via the router's `onDecision`). */
  sessionId?: string
}

/** `none` = nothing could decide (no eligible candidate, or every backend failed or abstained). */
export type Source = 'needle' | 'rules' | 'worker' | 'none'

export interface RouteDecision {
  class: DecisionClass
  choice: string | null
  source: Source
  latencyMs: number
  /** Worker (LLM) requests this decision cost. */
  workerRequests: number
  /** True when a worker request would normally have been spent and was not (decided by needle or rules). */
  requestSaved: boolean
  /** Backends tried and skipped before `source`, with why. */
  skipped: Array<{ source: Exclude<Source, 'none'>; why: string }>
}

/** A backend answers with one candidate id, or null to abstain. Throwing counts as failure. Never trusted: the router validates the id. */
export interface RouterBackend {
  readonly name: Exclude<Source, 'none'>
  /** Cheap availability check, never throws. `false` = skip silently (e.g. the Needle files are not there). */
  available?(): Promise<{ ok: boolean; why?: string }>
  decide(cls: DecisionClass, req: { task: string; candidates: Candidate[] }): Promise<string | null>
  /** Worker requests one `decide` call costs. Default 0. */
  readonly requestCost?: number
}

export interface RouterStats {
  decisions: number
  requestsSaved: number
  workerRequests: number
  bySource: Record<Source, number>
  byClass: Record<DecisionClass, { decisions: number; avgLatencyMs: number; bySource: Record<Source, number> }>
  failures: number
}
