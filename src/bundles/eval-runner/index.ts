import { Context, Service } from 'cordis'
import '../session-log/index.js'
import type { SessionEvent } from '../session-log/index.js'
import { defaultScorers } from './scorers.js'
import { EvalError, type EvalConfig, type EvalReport, type Scorer, type ScorerOutcome } from './types.js'

export * from './types.js'
export * from './scorers.js'

declare module 'cordis' {
  interface Context {
    eval: EvalRunner
  }
}

const DEFAULT_THRESHOLD = 0.7

/**
 * Score a run from its events alone. Pure: `scoreEvents(events, scorers)` reads nothing but its arguments, so the
 * same log through the same scorers always yields an identical report (6.1 determinism).
 */
export function scoreEvents(sessionId: string, events: readonly SessionEvent[], scorers: readonly Scorer[], threshold = DEFAULT_THRESHOLD): EvalReport {
  if (!(threshold >= 0 && threshold <= 1)) throw new EvalError(`eval: threshold must be between 0 and 1, got ${threshold}`)
  const names = new Set<string>()
  const results: ScorerOutcome[] = scorers.map((s) => {
    if (names.has(s.name)) throw new EvalError(`eval: two scorers are named "${s.name}"`)
    names.add(s.name)
    let r
    try {
      r = s.run(events)
    } catch (e: any) {
      // A scorer that crashes is a failed check, never a silently skipped one.
      r = { score: 0, pass: false, detail: `scorer threw: ${e?.message ?? e}`, applicable: true }
    }
    const weight = s.weight ?? 1
    if (!(weight >= 0)) throw new EvalError(`eval: scorer "${s.name}" has a negative weight`)
    return { name: s.name, required: !!s.required, weight, ...r }
  })
  const live = results.filter((r) => r.applicable)
  const wsum = live.reduce((n, r) => n + r.weight, 0)
  const score = wsum > 0 ? live.reduce((n, r) => n + r.score * r.weight, 0) / wsum : 0
  const failedReq = live.filter((r) => r.required && !r.pass)
  const failedOther = live.filter((r) => !r.required && !r.pass)
  const passed = failedReq.length === 0 && live.length > 0 && score >= threshold
  return { sessionId, eventCount: events.length, results, score, passed, threshold, failures: [...failedReq, ...failedOther].map((r) => r.name) }
}

/** `ctx.eval` (6.1): reads a session from `ctx.log` and scores it. Holds no state about any run. */
export class EvalRunner extends Service {
  static inject = ['log']
  private readonly scorers: Scorer[]
  private readonly threshold: number

  constructor(ctx: Context, config: EvalConfig = {}) {
    super(ctx, 'eval')
    this.scorers = config.scorers ?? defaultScorers()
    this.threshold = config.threshold ?? DEFAULT_THRESHOLD
    scoreEvents('', [], this.scorers, this.threshold) // validates names, weights and threshold at boot
  }

  /** Score a stored session. Extra scorers are added to (not substituted for) the configured set unless `only` is true. */
  async score(sessionId: string, opts: { scorers?: Scorer[]; only?: boolean; threshold?: number } = {}): Promise<EvalReport> {
    const events = await this.ctx.log.read(sessionId)
    const scorers = opts.only ? (opts.scorers ?? []) : [...this.scorers, ...(opts.scorers ?? [])]
    return scoreEvents(sessionId, events, scorers, opts.threshold ?? this.threshold)
  }
}

export const name = 'bundle-eval-runner'
export function apply(ctx: Context, config: EvalConfig = {}) {
  ctx.plugin(EvalRunner, config)
}
