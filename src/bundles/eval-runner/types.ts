import type { SessionEvent } from '../session-log/index.js'

/** What one scorer concluded about a run. `applicable: false` means "this question does not arise for this run". */
export interface ScorerResult {
  /** 0 (worst) to 1 (best). Ignored when not applicable. */
  score: number
  pass: boolean
  /** One human-readable line saying WHY, citing what in the log it looked at. */
  detail: string
  applicable: boolean
}

/**
 * A scorer is a pure function of the session's events: no clock, no randomness, no network, no live agent
 * state. That is what makes an eval reproducible (same log in, same report out) and what lets it run long
 * after the run, on a log copied from another machine.
 */
export interface Scorer {
  name: string
  /** A required scorer that is applicable and fails fails the whole run, whatever the average says. */
  required?: boolean
  /** Weight in the aggregate (default 1). */
  weight?: number
  run(events: readonly SessionEvent[]): ScorerResult
}

export interface ScorerOutcome extends ScorerResult {
  name: string
  required: boolean
  weight: number
}

export interface EvalReport {
  sessionId: string
  eventCount: number
  results: ScorerOutcome[]
  /** Weighted mean of the applicable scorers (0 when none apply). */
  score: number
  /** Every applicable required scorer passed AND `score >= threshold`. */
  passed: boolean
  threshold: number
  /** Names of applicable scorers that did not pass, required ones first. */
  failures: string[]
}

export interface EvalConfig {
  /** Aggregate score needed to pass (default 0.7). */
  threshold?: number
  /** Replace the default scorer set. */
  scorers?: Scorer[]
}

export class EvalError extends Error {
  override name = 'EvalError'
}
