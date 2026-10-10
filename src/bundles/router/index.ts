import { Context, Service } from 'cordis'
import { RulesBackend } from './backends.js'
import { DECISION_CLASSES, type DecisionClass, type RouteDecision, type RouteRequest, type RouterBackend, type RouterStats, type Source } from './types.js'

export * from './types.js'
export * from './backends.js'
export * from './suite.js'

declare module 'cordis' {
  interface Context {
    router: Router
  }
}

export interface RouterConfig {
  /** The Needle backend, if any. Absent or unavailable = the harness runs exactly as without it. */
  needle?: RouterBackend
  /** The worker backend (baseline and last fallback). Absent = rules only. */
  worker?: RouterBackend
  /**
   * Classes Needle may decide. DEFAULT: NONE. A class goes in this list only after it matched or beat the worker on the
   * frozen suite (D-026, `evaluateClass`); a class that did not stays with the worker. Needle is never asked about a class not listed.
   */
  owned?: DecisionClass[]
  /** Per backend call. Default 5000. */
  backendTimeoutMs?: number
  /** Called after every decision that has a sessionId; the profile uses it to write `router.decision` into the session log. A throw is swallowed. */
  onDecision?: (sessionId: string, d: RouteDecision) => void | Promise<void>
  /** Max tools offered for the `tool` class (D-026: top five). Default 5. */
  maxToolCandidates?: number
}

function emptyBySource(): Record<Source, number> {
  return { needle: 0, rules: 0, worker: 0, none: 0 }
}

/**
 * `ctx.router` (4.5). Chain per decision: owned class = needle -> rules -> worker; any other class = worker -> rules.
 * Every backend answer is validated against the candidates offered (an invented id is a failure, not a decision), every
 * backend call has a timeout, and a backend that throws, hangs, is missing or abstains just falls through. It never
 * throws for a backend problem and never blocks startup. The `tool` class only ever offers candidates marked `allowed`
 * (read-only or allowlisted): the router can narrow the choice, never widen it, and the policy gates still run on whatever is picked.
 */
export class Router extends Service {
  private readonly rules = new RulesBackend()
  private readonly owned: Set<DecisionClass>
  private readonly timeoutMs: number
  private readonly maxTools: number
  private failures = 0
  private readonly rows: RouteDecision[] = []

  constructor(ctx: Context, private readonly config: RouterConfig = {}) {
    super(ctx, 'router')
    this.owned = new Set(config.owned ?? [])
    this.timeoutMs = config.backendTimeoutMs ?? 5000
    this.maxTools = config.maxToolCandidates ?? 5
  }

  owns(cls: DecisionClass): boolean {
    return this.owned.has(cls)
  }

  private chain(cls: DecisionClass): RouterBackend[] {
    const c: Array<RouterBackend | undefined> = this.owned.has(cls) ? [this.config.needle, this.rules, this.config.worker] : [this.config.worker, this.rules]
    return c.filter((b): b is RouterBackend => !!b)
  }

  async decide(cls: DecisionClass, req: RouteRequest): Promise<RouteDecision> {
    const start = Date.now()
    let candidates = req.candidates
    if (cls === 'tool') candidates = candidates.filter((c) => c.allowed === true).slice(0, this.maxTools)
    const ids = new Set(candidates.map((c) => c.id))
    const skipped: RouteDecision['skipped'] = []
    let choice: string | null = null
    let source: Source = 'none'
    let workerRequests = 0
    if (candidates.length > 0) {
      for (const b of this.chain(cls)) {
        if (b.available) {
          let a: { ok: boolean; why?: string }
          try { a = await b.available() } catch (e: any) { a = { ok: false, why: String(e?.message ?? e).slice(0, 80) } }
          if (!a.ok) { skipped.push({ source: b.name, why: a.why ?? 'unavailable' }); continue }
        }
        workerRequests += b.requestCost ?? 0
        let timer: NodeJS.Timeout | undefined
        try {
          const ans = await Promise.race([
            b.decide(cls, { task: req.task, candidates }),
            new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timed out')), this.timeoutMs) }),
          ])
          if (ans === null || ans === undefined) { skipped.push({ source: b.name, why: 'abstained' }); continue }
          if (!ids.has(ans)) { this.failures++; skipped.push({ source: b.name, why: 'answered an id that was not offered' }); continue }
          choice = ans
          source = b.name
          break
        } catch (e: any) {
          this.failures++
          skipped.push({ source: b.name, why: String(e?.message ?? e).slice(0, 80) })
        } finally {
          if (timer) clearTimeout(timer)
        }
      }
    }
    const d: RouteDecision = {
      class: cls, choice, source, latencyMs: Date.now() - start, workerRequests, skipped,
      // a worker request would have been spent for this decision and was not
      requestSaved: choice !== null && (source === 'needle' || source === 'rules') && workerRequests === 0 && !!this.config.worker,
    }
    this.rows.push(d)
    if (req.sessionId && this.config.onDecision) {
      try { await this.config.onDecision(req.sessionId, d) } catch { /* a logging hook must never break routing */ }
    }
    return d
  }

  /** Requests saved per task is recorded here and in the session log (`router.decision`). */
  stats(): RouterStats {
    const byClass = {} as RouterStats['byClass']
    for (const c of DECISION_CLASSES) byClass[c] = { decisions: 0, avgLatencyMs: 0, bySource: emptyBySource() }
    const bySource = emptyBySource()
    let saved = 0
    let wr = 0
    for (const r of this.rows) {
      bySource[r.source]++
      const k = byClass[r.class]
      k.decisions++
      k.avgLatencyMs += r.latencyMs
      k.bySource[r.source]++
      if (r.requestSaved) saved++
      wr += r.workerRequests
    }
    for (const c of DECISION_CLASSES) if (byClass[c].decisions) byClass[c].avgLatencyMs = Math.round((byClass[c].avgLatencyMs / byClass[c].decisions) * 10) / 10
    return { decisions: this.rows.length, requestsSaved: saved, workerRequests: wr, bySource, byClass, failures: this.failures }
  }
}

export const name = 'bundle-router'
export function apply(ctx: Context, config: RouterConfig = {}) {
  ctx.plugin(Router, config)
}
