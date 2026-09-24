import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type BudgetScope = 'task' | 'session' | 'day'
export type BudgetMetric = 'requests' | 'tokens'

export interface BudgetLimit {
  soft?: number
  hard?: number
}

export interface BudgetsConfig {
  /** Limits per scope, per metric. An unconfigured scope/metric is unlimited. */
  requests?: Partial<Record<BudgetScope, BudgetLimit>>
  tokens?: Partial<Record<BudgetScope, BudgetLimit>>
  /**
   * Persist the day counters here so a restart does not reset "requests
   * left today" (mirrors `RateLimiter`'s `statePath`, D-023). Omit for
   * in-memory only - `task` and `session` are always in-memory.
   */
  statePath?: string
  /** Injectable for tests. */
  now?: () => number
}

export interface ScopeStatus {
  used: number
  soft?: number
  hard?: number
  softBreached: boolean
  hardBreached: boolean
}

export type BudgetStatus = Record<BudgetMetric, Record<BudgetScope, ScopeStatus>>

/** Thrown by `spend()` before anything is recorded - a "hard stop with a report" (1B.2). */
export class BudgetExceededError extends Error {
  override name = 'BudgetExceededError'
  constructor(
    public metric: BudgetMetric,
    public scope: BudgetScope,
    /** Full status across every scope/metric as of the rejected attempt, not just the one that tripped it. */
    public status: BudgetStatus,
  ) {
    const s = status[metric][scope]
    super(`budget: ${metric}/${scope} hard limit reached (${s.used}/${s.hard})`)
  }
}

export interface SpendResult {
  metric: BudgetMetric
  amount: number
  status: BudgetStatus
  /** Scopes whose soft limit was crossed *by this call* - for a one-time warning, not a repeat one. */
  newlySoftBreached: Array<{ metric: BudgetMetric; scope: BudgetScope }>
}

interface DayState {
  day: string
  requests: number
  tokens: number
}

const METRICS: BudgetMetric[] = ['requests', 'tokens']
// Checked (and reported) in this order: the narrowest scope trips first.
const SCOPES: BudgetScope[] = ['task', 'session', 'day']

function todayUTC(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/**
 * Tracks request/token spend against soft/hard limits at three scopes
 * (task, session, day). `task` and `session` are in-memory only, reset via
 * `resetTask()`/`resetSession()` at the caller's own boundaries. `day`
 * rolls over at the UTC day boundary and persists across restarts when
 * `statePath` is set.
 *
 * `spend()` is all-or-nothing: if applying `amount` would push *any* scope
 * over its hard limit, nothing is recorded anywhere and
 * `BudgetExceededError` carries a full status snapshot across every
 * scope/metric, not just the one number that tripped it.
 */
export class Budgets {
  private readonly config: BudgetsConfig
  private readonly now: () => number
  private task = { requests: 0, tokens: 0 }
  private session = { requests: 0, tokens: 0 }
  private day: DayState

  constructor(config: BudgetsConfig = {}) {
    this.config = config
    this.now = config.now ?? Date.now
    this.day = this.loadDay()
  }

  private loadDay(): DayState {
    const today = todayUTC(this.now())
    if (this.config.statePath) {
      try {
        const raw = JSON.parse(readFileSync(this.config.statePath, 'utf8')) as DayState
        if (raw.day === today) return raw
      } catch {
        // No file yet, or unreadable/corrupt - start fresh rather than crash.
      }
    }
    return { day: today, requests: 0, tokens: 0 }
  }

  private saveDay(): void {
    if (!this.config.statePath) return
    mkdirSync(dirname(this.config.statePath), { recursive: true })
    const tmp = `${this.config.statePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
    writeFileSync(tmp, JSON.stringify(this.day))
    renameSync(tmp, this.config.statePath)
  }

  private rollDayIfNeeded(): void {
    const today = todayUTC(this.now())
    if (this.day.day !== today) {
      this.day = { day: today, requests: 0, tokens: 0 }
      this.saveDay()
    }
  }

  private limitFor(metric: BudgetMetric, scope: BudgetScope): BudgetLimit | undefined {
    return this.config[metric]?.[scope]
  }

  private usedFor(metric: BudgetMetric, scope: BudgetScope): number {
    if (scope === 'task') return this.task[metric]
    if (scope === 'session') return this.session[metric]
    return this.day[metric]
  }

  status(): BudgetStatus {
    this.rollDayIfNeeded()
    const out = {} as BudgetStatus
    for (const metric of METRICS) {
      out[metric] = {} as Record<BudgetScope, ScopeStatus>
      for (const scope of SCOPES) {
        const limit = this.limitFor(metric, scope)
        const used = this.usedFor(metric, scope)
        out[metric][scope] = {
          used,
          soft: limit?.soft,
          hard: limit?.hard,
          softBreached: limit?.soft !== undefined && used >= limit.soft,
          hardBreached: limit?.hard !== undefined && used >= limit.hard,
        }
      }
    }
    return out
  }

  /** `undefined` if no daily hard request limit is configured (there is no ceiling to count down from). */
  requestsLeftToday(): number | undefined {
    this.rollDayIfNeeded()
    const hard = this.limitFor('requests', 'day')?.hard
    return hard === undefined ? undefined : Math.max(0, hard - this.day.requests)
  }

  /**
   * Records `amount` of `metric` against task, session and day at once.
   * Throws `BudgetExceededError` (nothing recorded, any scope) if doing so
   * would put task, session, or day - checked in that order - over its
   * hard limit.
   */
  spend(metric: BudgetMetric, amount: number): SpendResult {
    if (amount < 0) throw new RangeError('budget: spend amount must not be negative')
    this.rollDayIfNeeded()

    for (const scope of SCOPES) {
      const limit = this.limitFor(metric, scope)
      if (limit?.hard === undefined) continue
      if (this.usedFor(metric, scope) + amount > limit.hard) {
        throw new BudgetExceededError(metric, scope, this.status())
      }
    }

    const before = SCOPES.map((scope) => ({ scope, was: this.usedFor(metric, scope) }))
    this.task[metric] += amount
    this.session[metric] += amount
    this.day[metric] += amount
    this.saveDay()

    const newlySoftBreached: SpendResult['newlySoftBreached'] = []
    for (const { scope, was } of before) {
      const soft = this.limitFor(metric, scope)?.soft
      if (soft !== undefined && was < soft && this.usedFor(metric, scope) >= soft) {
        newlySoftBreached.push({ metric, scope })
      }
    }

    return { metric, amount, status: this.status(), newlySoftBreached }
  }

  resetTask(): void {
    this.task = { requests: 0, tokens: 0 }
  }

  resetSession(): void {
    this.session = { requests: 0, tokens: 0 }
  }
}
