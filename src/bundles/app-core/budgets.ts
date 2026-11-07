import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
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

/**
 * Capacity held for a call that is in flight (ARCH-03). `spend()` after the fact cannot stop a request that is
 * itself too big; a reservation is checked against the hard limits BEFORE the call and counted against every
 * other caller until it is settled or released, so concurrent sub-agents cannot each see "enough left".
 */
export interface Reservation {
  readonly metric: BudgetMetric
  readonly amount: number
  /** True once released or settled; both are then no-ops. */
  done: boolean
}

export interface SpendResult {
  metric: BudgetMetric
  amount: number
  status: BudgetStatus
  /** Scopes whose soft limit was crossed *by this call* - for a one-time warning, not a repeat one. */
  newlySoftBreached: Array<{ metric: BudgetMetric; scope: BudgetScope }>
}

/**
 * BUG-10: the persisted day counters exist to stop spending, so a state file that is present but cannot be
 * trusted must stop the harness rather than quietly grant a fresh day. A MISSING file is a normal first run
 * and is not an error; an unreadable, non-JSON or malformed file is. The message names the path so the owner
 * can inspect or delete it deliberately.
 */
export class BudgetStateError extends Error {
  override name = 'BudgetStateError'
  constructor(public statePath: string, reason: string) {
    super(`budget: the saved usage file ${statePath} cannot be trusted (${reason}). Refusing to start so spending is not silently reset; inspect it, or delete it to start the day from zero on purpose.`)
  }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const validCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

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
  /** Capacity currently held by in-flight reservations (not yet spent). */
  private reserved: Record<BudgetMetric, number> = { requests: 0, tokens: 0 }

  constructor(config: BudgetsConfig = {}) {
    this.config = config
    this.now = config.now ?? Date.now
    for (const metric of METRICS) {
      for (const scope of SCOPES) {
        const limit = config[metric]?.[scope]
        if (!limit) continue
        for (const [name, value] of [['soft', limit.soft], ['hard', limit.hard]] as const) {
          if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
            throw new RangeError(`budget: ${metric}/${scope} ${name} limit must be a finite non-negative number`)
          }
        }
        if (limit.soft !== undefined && limit.hard !== undefined && limit.soft > limit.hard) {
          throw new RangeError(`budget: ${metric}/${scope} soft limit cannot exceed hard limit`)
        }
      }
    }
    this.day = this.loadDay()
  }

  private loadDay(): DayState {
    const today = todayUTC(this.now())
    const path = this.config.statePath
    if (path) {
      let text: string
      try {
        text = readFileSync(path, 'utf8')
      } catch (e: any) {
        if (e?.code === 'ENOENT') return { day: today, requests: 0, tokens: 0 } // first run: nothing saved yet
        throw new BudgetStateError(path, `unreadable: ${e?.code ?? e?.message ?? e}`)
      }
      let raw: any
      try {
        raw = JSON.parse(text)
      } catch {
        throw new BudgetStateError(path, 'not valid JSON')
      }
      if (!raw || typeof raw !== 'object' || typeof raw.day !== 'string' || !DAY_RE.test(raw.day) || !validCount(raw.requests) || !validCount(raw.tokens)) {
        throw new BudgetStateError(path, 'unexpected contents: day must be YYYY-MM-DD and requests/tokens must be non-negative numbers')
      }
      // Valid file from an earlier day: the day has genuinely rolled over, so counters restart.
      if (raw.day === today) return { day: raw.day, requests: raw.requests, tokens: raw.tokens }
    }
    return { day: today, requests: 0, tokens: 0 }
  }

  private saveDay(): void {
    if (!this.config.statePath) return
    mkdirSync(dirname(this.config.statePath), { recursive: true })
    const tmp = `${this.config.statePath}.tmp-${process.pid}-${randomUUID()}`
    try {
      writeFileSync(tmp, JSON.stringify(this.day), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      renameSync(tmp, this.config.statePath)
    } catch (err) {
      try { unlinkSync(tmp) } catch {}
      throw err
    }
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
    return hard === undefined ? undefined : Math.max(0, hard - this.day.requests - this.reserved.requests)
  }

  /**
   * Hold `amount` of `metric` for an in-flight call. Throws `BudgetExceededError` (nothing held) if spent + held + `amount`
   * would pass any hard limit. Synchronous on purpose: two concurrent callers cannot both pass the check against the same
   * remaining capacity. Pair every successful `reserve` with exactly one `release` (the call is not made / failed) or a
   * `record` followed by `release` (it was made).
   */
  reserve(metric: BudgetMetric, amount: number): Reservation {
    if (!Number.isFinite(amount) || amount < 0) throw new RangeError('budget: reserve amount must be finite and non-negative')
    this.rollDayIfNeeded()
    for (const scope of SCOPES) {
      const limit = this.limitFor(metric, scope)
      if (limit?.hard === undefined) continue
      if (this.usedFor(metric, scope) + this.reserved[metric] + amount > limit.hard) {
        throw new BudgetExceededError(metric, scope, this.status())
      }
    }
    this.reserved[metric] += amount
    return { metric, amount, done: false }
  }

  /** Give a reservation back. Idempotent. */
  release(r: Reservation): void {
    if (r.done) return
    r.done = true
    this.reserved[r.metric] = Math.max(0, this.reserved[r.metric] - r.amount)
  }

  /**
   * Book what was ACTUALLY spent. Unlike `spend()` this never refuses: the tokens or request are already gone, and hiding
   * an overshoot would let the next check pass. The overshoot shows up in `status()` and blocks the next `reserve`.
   */
  record(metric: BudgetMetric, amount: number): SpendResult {
    if (!Number.isFinite(amount) || amount < 0) throw new RangeError('budget: record amount must be finite and non-negative')
    this.rollDayIfNeeded()
    return this.book(metric, amount)
  }

  /**
   * Record `amount` of `metric`. If that would put any scope over its hard limit, nothing is recorded and
   * `BudgetExceededError` is thrown. (Does not count capacity held by reservations; callers that gate in-flight work
   * use `reserve` + `record`.)
   */
  spend(metric: BudgetMetric, amount: number): SpendResult {
    if (!Number.isFinite(amount) || amount < 0) throw new RangeError('budget: spend amount must be finite and non-negative')
    this.rollDayIfNeeded()

    for (const scope of SCOPES) {
      const limit = this.limitFor(metric, scope)
      if (limit?.hard === undefined) continue
      if (this.usedFor(metric, scope) + amount > limit.hard) {
        throw new BudgetExceededError(metric, scope, this.status())
      }
    }
    return this.book(metric, amount)
  }

  private book(metric: BudgetMetric, amount: number): SpendResult {
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
