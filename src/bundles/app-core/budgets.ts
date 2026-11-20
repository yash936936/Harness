import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { assertNoSymlinkParentsSync, readTextFileSyncNoFollow } from '../../util/secure-file.js'
import { createHash, randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { SQLiteDatabase, type SQLiteConnection, type SQLiteMigration, type SQLiteValue } from '../../util/sqlite.js'
import type { BudgetReservation, BudgetReservationRequest, BudgetReservationStore, BudgetSettlement, ReservationDecision, RateLimitRequest, RateLimitPermit, RateLimitDecision, RateLimitStore, LeaseRequest, Lease, LeaseDecision, LeaseStore } from '../../architecture/contracts.js'

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

function validDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
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
  if (!Number.isFinite(now)) throw new RangeError('budget: clock must return a finite timestamp')
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
        const scopes = config[metric]
        if (scopes !== undefined && (!scopes || typeof scopes !== 'object' || Array.isArray(scopes))) {
          throw new RangeError(`budget: ${metric} scopes must be an object`)
        }
        const limit = scopes?.[scope]
        if (limit === undefined) continue
        if (!limit || typeof limit !== 'object' || Array.isArray(limit)) throw new RangeError(`budget: ${metric}/${scope} limit must be an object`)
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
        text = readTextFileSyncNoFollow(path)
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
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !validDayKey(raw.day) || !validCount(raw.requests) || !validCount(raw.tokens)) {
        throw new BudgetStateError(path, 'unexpected contents: day must be a real YYYY-MM-DD calendar date and requests/tokens must be non-negative numbers')
      }
      if (raw.day > today) throw new BudgetStateError(path, 'saved day is ahead of the system date')
      // Valid file from an earlier day: the day has genuinely rolled over, so counters restart.
      if (raw.day === today) return { day: raw.day, requests: raw.requests, tokens: raw.tokens }
    }
    return { day: today, requests: 0, tokens: 0 }
  }

  private saveDay(): void {
    if (!this.config.statePath) return
    assertNoSymlinkParentsSync(this.config.statePath)
    mkdirSync(dirname(this.config.statePath), { recursive: true })
    assertNoSymlinkParentsSync(this.config.statePath)
    const tmp = `${this.config.statePath}.tmp-${process.pid}-${randomUUID()}`
    try {
      writeFileSync(tmp, JSON.stringify(this.day), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      assertNoSymlinkParentsSync(this.config.statePath)
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

  /** Configured hard ceiling for one scope, if any. */
  hardLimit(metric: BudgetMetric, scope: BudgetScope): number | undefined {
    return this.limitFor(metric, scope)?.hard
  }

  /** Stable UTC day bucket used by shared reservations. */
  currentDay(): string {
    return todayUTC(this.now())
  }

  /** Injectable clock value used to derive reservation expiries consistently. */
  currentTimestamp(): number {
    return this.now()
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
  reserve(metric: BudgetMetric, amount: number, sharedTaskScope = false): Reservation {
    if (!Number.isFinite(amount) || amount < 0) throw new RangeError('budget: reserve amount must be finite and non-negative')
    this.rollDayIfNeeded()
    for (const scope of SCOPES) {
      if (scope === 'task' && sharedTaskScope) continue
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


/* ---------------------------------------------------------------- shared SQLite reservations */

export const BUDGET_RESERVATION_MIGRATIONS: readonly SQLiteMigration[] = [{
  version: 1,
  id: 'budget-reservations',
  sql: `
    CREATE TABLE budget_usage (
      project_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      metric TEXT NOT NULL CHECK (metric IN ('requests', 'tokens', 'bytes', 'operations')),
      committed_amount REAL NOT NULL CHECK (committed_amount >= 0),
      hard_limit REAL NOT NULL CHECK (hard_limit >= 0),
      PRIMARY KEY (project_id, subject_id, metric)
    );
    CREATE TABLE budget_reservations (
      reservation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      metric TEXT NOT NULL CHECK (metric IN ('requests', 'tokens', 'bytes', 'operations')),
      reserved_amount REAL NOT NULL CHECK (reserved_amount >= 0),
      state TEXT NOT NULL CHECK (state IN ('reserved', 'settled', 'released', 'expired')),
      expires_at TEXT NOT NULL,
      actual_amount REAL,
      settlement_key TEXT,
      settlement_amount REAL,
      release_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX budget_reservations_subject_state
      ON budget_reservations (project_id, subject_id, metric, state, expires_at);
    CREATE TABLE budget_idempotency (
      project_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      accepted INTEGER NOT NULL CHECK (accepted IN (0, 1)),
      reservation_id TEXT,
      reason TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, idempotency_key)
    );
    CREATE TABLE budget_settlements (
      project_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      reservation_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, idempotency_key)
    );
  `,
}, {
  version: 2,
  id: 'shared-rate-limits',
  sql: `
    CREATE TABLE rate_limit_events (
      event_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      bucket TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX rate_limit_events_window
      ON rate_limit_events (project_id, principal_id, bucket, occurred_at);
    CREATE TABLE rate_limit_permits (
      permit_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      bucket TEXT NOT NULL,
      fencing_token INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('active', 'released', 'expired'))
    );
    CREATE INDEX rate_limit_permits_active
      ON rate_limit_permits (project_id, principal_id, bucket, expires_at);
    CREATE TABLE rate_limit_fences (
      project_id TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      bucket TEXT NOT NULL,
      next_token INTEGER NOT NULL,
      PRIMARY KEY (project_id, principal_id, bucket)
    );
    CREATE TABLE rate_limit_idempotency (
      project_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      accepted INTEGER NOT NULL CHECK (accepted IN (0, 1)),
      permit_id TEXT,
      reason TEXT,
      retry_at INTEGER,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, idempotency_key)
    );
  `,
}, {
  version: 3,
  id: 'fenced-resource-leases',
  sql: `
    CREATE TABLE resource_leases (
      lease_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      resource_type TEXT NOT NULL CHECK (resource_type IN ('workspace', 'job', 'index')),
      resource_id TEXT NOT NULL, owner_id TEXT NOT NULL, fencing_token INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('active', 'released', 'expired')),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX resource_leases_current ON resource_leases (project_id, resource_type, resource_id, state, expires_at);
    CREATE TABLE resource_lease_fences (
      project_id TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, next_token INTEGER NOT NULL,
      PRIMARY KEY (project_id, resource_type, resource_id)
    );
    CREATE TABLE resource_lease_idempotency (
      project_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
      lease_id TEXT, reason TEXT, expires_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, idempotency_key)
    );
  `,
}, {
  version: 4,
  id: 'stable-rate-limit-policies',
  sql: `
    CREATE TABLE rate_limit_policies (
      project_id TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      bucket TEXT NOT NULL,
      limit_count INTEGER NOT NULL CHECK (limit_count > 0),
      window_ms INTEGER NOT NULL CHECK (window_ms > 0),
      max_concurrent INTEGER NOT NULL CHECK (max_concurrent > 0),
      PRIMARY KEY (project_id, principal_id, bucket)
    );
  `,
}, {
  version: 5,
  id: 'legacy-budget-imports',
  sql: `
    CREATE TABLE budget_legacy_imports (
      project_id TEXT NOT NULL,
      day TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      PRIMARY KEY (project_id, day)
    );
  `,
}, {
  version: 6,
  id: 'task-scoped-workspace-sessions',
  sql: `
    CREATE TABLE workspace_sessions (
      workspace_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('creating', 'ready', 'transferring', 'running', 'closing', 'closed', 'failed', 'unknown')),
      owner_id TEXT NOT NULL,
      lease_id TEXT NOT NULL,
      fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (project_id, task_id, session_id)
    );
    CREATE INDEX workspace_sessions_project_state
      ON workspace_sessions (project_id, state, expires_at);
    CREATE TABLE workspace_session_idempotency (
      project_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, idempotency_key)
    );
    CREATE TABLE workspace_capabilities (
      capability_id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
      operations_json TEXT NOT NULL,
      path_prefixes_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      revoke_reason TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX workspace_capabilities_active
      ON workspace_capabilities (workspace_id, revoked_at, expires_at);
  `,
}]

/**
 * Explicitly migrate the current legacy Budgets.statePath snapshot into a
 * project's SQLite day bucket. The source file is never deleted or rewritten.
 * A stale prior-day file is already rolled over and imports as a no-op.
 */
export async function migrateLegacyBudgetStateToSQLite(input: {
  statePath: string
  databasePath: string
  projectId: string
  requestHardLimit?: number
  tokenHardLimit?: number
  now?: () => number
}): Promise<{ imported: boolean; day: string }> {
  if (typeof input.statePath !== 'string' || !input.statePath.trim() ||
      typeof input.databasePath !== 'string' || !input.databasePath.trim() ||
      typeof input.projectId !== 'string' || !input.projectId.trim()) {
    throw new TypeError('budget migration: statePath, databasePath, and projectId are required')
  }
  const now = input.now ?? Date.now
  const day = todayUTC(now())
  let raw: string
  try {
    raw = readTextFileSyncNoFollow(input.statePath)
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { imported: false, day }
    throw new BudgetStateError(input.statePath, `unreadable: ${error?.code ?? error?.message ?? error}`)
  }
  let parsed: any
  try { parsed = JSON.parse(raw) } catch {
    throw new BudgetStateError(input.statePath, 'not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      !validDayKey(parsed.day) || !validCount(parsed.requests) || !validCount(parsed.tokens)) {
    throw new BudgetStateError(input.statePath, 'unexpected contents: day must be a real YYYY-MM-DD calendar date and requests/tokens must be non-negative numbers')
  }
  if (parsed.day > day) throw new BudgetStateError(input.statePath, 'saved day is ahead of the system date')
  if (parsed.day < day) return { imported: false, day }
  const requestHardLimit = input.requestHardLimit ?? Number.MAX_SAFE_INTEGER
  const tokenHardLimit = input.tokenHardLimit ?? Number.MAX_SAFE_INTEGER
  if (!validCount(requestHardLimit) || !validCount(tokenHardLimit)) {
    throw new RangeError('budget migration: hard limits must be finite non-negative numbers')
  }
  const store = new SQLiteBudgetReservationStore(input.databasePath, { now })
  const result = await store.importLegacyDayUsage({
    projectId: input.projectId,
    day,
    requests: parsed.requests,
    tokens: parsed.tokens,
    requestHardLimit,
    tokenHardLimit,
    sourceHash: createHash('sha256').update(raw, 'utf8').digest('hex'),
  })
  return { imported: result.imported, day }
}

export interface SQLiteRateLimitStoreOptions {
  now?: () => number
  maxPermitTtlMs?: number
}

/** Cross-process sliding-window accounting and concurrency permits in one SQLite transaction. */
export class SQLiteRateLimitStore implements RateLimitStore {
  private readonly database: SQLiteDatabase
  private readonly now: () => number
  private readonly maxPermitTtlMs: number
  private readyPromise?: Promise<void>

  constructor(path: string, options: SQLiteRateLimitStoreOptions = {}) {
    this.database = new SQLiteDatabase(path, BUDGET_RESERVATION_MIGRATIONS)
    this.now = options.now ?? Date.now
    this.maxPermitTtlMs = options.maxPermitTtlMs ?? 10 * 60 * 1000
    if (!Number.isSafeInteger(this.maxPermitTtlMs) || this.maxPermitTtlMs < 1_000 || this.maxPermitTtlMs > 24 * 60 * 60 * 1000) {
      throw new RangeError('rate limits: maxPermitTtlMs must be from 1000 ms to 24 hours')
    }
  }

  private async ready(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = (async () => {
      const plan = await this.database.plan()
      if (plan.pending.length) {
        try { await this.database.apply(plan) }
        catch (error) {
          const current = await this.database.plan()
          if (current.pending.length) await this.database.apply(current)
          else if (current.currentVersion < current.targetVersion) throw error
        }
      }
      await this.database.verify()
    })()
    await this.readyPromise
  }

  private query(db: SQLiteConnection, sql: string, values: readonly SQLiteValue[] = []): Record<string, unknown>[] {
    const statement = db.prepare(sql)
    try {
      if (values.length) statement.bind(values)
      const result: Record<string, unknown>[] = []
      while (statement.step()) result.push(statement.getAsObject())
      return result
    } finally { statement.free() }
  }

  private permit(db: SQLiteConnection, id: string): RateLimitPermit {
    const row = this.query(db, 'SELECT permit_id, project_id, principal_id, bucket, fencing_token, expires_at FROM rate_limit_permits WHERE permit_id = ?', [id])[0]
    if (!row) throw new Error(`rate limits: permit ${id} no longer exists`)
    return {
      permitId: String(row['permit_id']),
      projectId: String(row['project_id']),
      principalId: String(row['principal_id']),
      bucket: String(row['bucket']),
      fencingToken: Number(row['fencing_token']),
      expiresAt: new Date(Number(row['expires_at'])).toISOString(),
    }
  }

  async acquire(input: RateLimitRequest): Promise<RateLimitDecision> {
    if (!input || typeof input !== 'object') throw new TypeError('rate limits: request must be an object')
    for (const [name, value] of [['projectId', input.projectId], ['principalId', input.principalId], ['bucket', input.bucket], ['idempotencyKey', input.idempotencyKey]] as const) {
      if (typeof value !== 'string' || !value.trim() || value.length > 256 || (name === 'idempotencyKey' && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value))) {
        throw new TypeError(`rate limits: ${name} must be a valid non-empty identifier of at most 256 characters`)
      }
    }
    for (const [name, value] of [['limit', input.limit], ['windowMs', input.windowMs], ['maxConcurrent', input.maxConcurrent], ['permitTtlMs', input.permitTtlMs]] as const) {
      if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`rate limits: ${name} must be a positive safe integer`)
    }
    if (input.permitTtlMs > this.maxPermitTtlMs) throw new RangeError('rate limits: permitTtlMs exceeds configured maximum')
    const now = this.now()
    if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('rate limits: clock must return a non-negative safe integer')
    const expiresAt = now + input.permitTtlMs
    if (!Number.isSafeInteger(expiresAt)) throw new RangeError('rate limits: permit expiry exceeds safe timestamp range')
    const requestHash = createHash('sha256').update(JSON.stringify({
      projectId: input.projectId, principalId: input.principalId, bucket: input.bucket,
      limit: input.limit, windowMs: input.windowMs, maxConcurrent: input.maxConcurrent, permitTtlMs: input.permitTtlMs,
    }), 'utf8').digest('hex')
    await this.ready()
    return this.database.transaction((db) => {
      db.run('DELETE FROM rate_limit_events WHERE expires_at <= ?', [now])
      db.run("UPDATE rate_limit_permits SET state = 'expired' WHERE state = 'active' AND expires_at <= ?", [now])
      db.run('DELETE FROM rate_limit_permits WHERE expires_at <= ?', [now])
      db.run('DELETE FROM rate_limit_idempotency WHERE expires_at <= ?', [now])
      const prior = this.query(db, 'SELECT request_hash, accepted, permit_id, reason, retry_at FROM rate_limit_idempotency WHERE project_id = ? AND idempotency_key = ?', [input.projectId, input.idempotencyKey])[0]
      if (prior) {
        if (String(prior['request_hash']) !== requestHash) return { accepted: false, reason: 'idempotency-conflict' }
        if (Number(prior['accepted']) === 0) return {
          accepted: false,
          reason: String(prior['reason']) as 'rate-limited' | 'concurrency-limit',
          ...(prior['retry_at'] === null ? {} : { retryAt: new Date(Number(prior['retry_at'])).toISOString() }),
        }
        return { accepted: true, permit: this.permit(db, String(prior['permit_id'])) }
      }
      const policy = this.query(db, 'SELECT limit_count, window_ms, max_concurrent FROM rate_limit_policies WHERE project_id = ? AND principal_id = ? AND bucket = ?', [input.projectId, input.principalId, input.bucket])[0]
      if (policy && (Number(policy['limit_count']) !== input.limit || Number(policy['window_ms']) !== input.windowMs || Number(policy['max_concurrent']) !== input.maxConcurrent)) {
        throw new Error('rate limits: policy changed for an existing project/principal/bucket; use a new bucket or perform an explicit migration')
      }
      if (!policy) {
        db.run('INSERT INTO rate_limit_policies (project_id, principal_id, bucket, limit_count, window_ms, max_concurrent) VALUES (?, ?, ?, ?, ?, ?)', [input.projectId, input.principalId, input.bucket, input.limit, input.windowMs, input.maxConcurrent])
      }
      const windowStart = now - input.windowMs
      const events = this.query(db, 'SELECT COUNT(*) AS count, MIN(expires_at) AS retry_at FROM rate_limit_events WHERE project_id = ? AND principal_id = ? AND bucket = ? AND occurred_at > ?', [input.projectId, input.principalId, input.bucket, windowStart])[0]
      const active = this.query(db, "SELECT COUNT(*) AS count, MIN(expires_at) AS retry_at FROM rate_limit_permits WHERE project_id = ? AND principal_id = ? AND bucket = ? AND state = 'active' AND expires_at > ?", [input.projectId, input.principalId, input.bucket, now])[0]
      const eventCount = Number(events?.['count'] ?? 0)
      const activeCount = Number(active?.['count'] ?? 0)
      let reason: 'rate-limited' | 'concurrency-limit' | undefined
      let retryAt: number | undefined
      if (eventCount >= input.limit) {
        reason = 'rate-limited'
        retryAt = Number(events?.['retry_at'])
      } else if (activeCount >= input.maxConcurrent) {
        reason = 'concurrency-limit'
        retryAt = Number(active?.['retry_at'])
      }
      if (reason) {
        db.run('INSERT INTO rate_limit_idempotency (project_id, idempotency_key, request_hash, accepted, permit_id, reason, retry_at, expires_at) VALUES (?, ?, ?, 0, NULL, ?, ?, ?)', [input.projectId, input.idempotencyKey, requestHash, reason, retryAt ?? null, expiresAt])
        return { accepted: false, reason, ...(retryAt ? { retryAt: new Date(retryAt).toISOString() } : {}) }
      }
      const fence = this.query(db, 'SELECT next_token FROM rate_limit_fences WHERE project_id = ? AND principal_id = ? AND bucket = ?', [input.projectId, input.principalId, input.bucket])[0]
      const fencingToken = Number(fence?.['next_token'] ?? 1)
      db.run('INSERT INTO rate_limit_fences (project_id, principal_id, bucket, next_token) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, principal_id, bucket) DO UPDATE SET next_token = excluded.next_token', [input.projectId, input.principalId, input.bucket, fencingToken + 1])
      const permitId = randomUUID()
      db.run("INSERT INTO rate_limit_permits (permit_id, project_id, principal_id, bucket, fencing_token, expires_at, state) VALUES (?, ?, ?, ?, ?, ?, 'active')", [permitId, input.projectId, input.principalId, input.bucket, fencingToken, expiresAt])
      db.run('INSERT INTO rate_limit_events (event_id, project_id, principal_id, bucket, occurred_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), input.projectId, input.principalId, input.bucket, now, now + input.windowMs])
      db.run('INSERT INTO rate_limit_idempotency (project_id, idempotency_key, request_hash, accepted, permit_id, reason, retry_at, expires_at) VALUES (?, ?, ?, 1, ?, NULL, NULL, ?)', [input.projectId, input.idempotencyKey, requestHash, permitId, expiresAt])
      return { accepted: true, permit: this.permit(db, permitId) }
    })
  }

  async release(permitId: string): Promise<void> {
    if (typeof permitId !== 'string' || !permitId.trim()) throw new TypeError('rate limits: permitId must be non-empty')
    await this.ready()
    await this.database.transaction((db) => { db.run("UPDATE rate_limit_permits SET state = 'released' WHERE permit_id = ? AND state = 'active'", [permitId]) })
  }
}

export interface SQLiteBudgetReservationStoreOptions {
  /** Injectable clock for tests. */
  now?: () => number
  /** Bounds live reservations and the idempotency replay window. Default 24 hours. */
  maxReservationTtlMs?: number
}

/** Errors are fail-closed: callers must not dispatch when reservation state is uncertain. */
export class BudgetReservationStoreError extends Error {
  override name = 'BudgetReservationStoreError'
}

/**
 * Cross-process budget reservations backed by the shared SQLite database.
 *
 * Settled usage is folded into one aggregate per (project, subject, metric).
 * Active reservations and idempotency records are retained only through a
 * bounded expiry/grace window, keeping this database suitable for coordination
 * metadata rather than an unbounded event history.
 */
export class SQLiteBudgetReservationStore implements BudgetReservationStore {
  private readonly database: SQLiteDatabase
  private readonly now: () => number
  private readonly maxReservationTtlMs: number
  private readyPromise?: Promise<void>

  constructor(path: string, options: SQLiteBudgetReservationStoreOptions = {}) {
    this.database = new SQLiteDatabase(path, BUDGET_RESERVATION_MIGRATIONS)
    this.now = options.now ?? Date.now
    this.maxReservationTtlMs = options.maxReservationTtlMs ?? 24 * 60 * 60 * 1000
    if (!Number.isSafeInteger(this.maxReservationTtlMs) || this.maxReservationTtlMs < 1_000 || this.maxReservationTtlMs > 7 * 24 * 60 * 60 * 1000) {
      throw new RangeError('budget reservations: maxReservationTtlMs must be from 1000 ms to 7 days')
    }
  }

  private async ready(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = this.initialize()
    await this.readyPromise
  }

  private async initialize(): Promise<void> {
    const plan = await this.database.plan()
    if (plan.pending.length) {
      try {
        await this.database.apply(plan)
      } catch (error) {
        // Another Harness process may have applied the same migration after our
        // read-only plan. Re-plan once; never ignore a checksum or schema error.
        const current = await this.database.plan()
        if (current.pending.length) await this.database.apply(current)
        else if (current.currentVersion < current.targetVersion) throw error
      }
    }
    await this.database.verify()
  }

  private timestamp(): string {
    const value = this.now()
    if (!Number.isFinite(value)) throw new RangeError('budget reservations: clock must return a finite timestamp')
    return new Date(value).toISOString()
  }

  private validateRequest(input: BudgetReservationRequest): { nowMs: number; expiresAt: string; requestHash: string } {
    if (!input || typeof input !== 'object') throw new TypeError('budget reservations: request must be an object')
    for (const [name, value] of [['projectId', input.projectId], ['subjectId', input.subjectId]] as const) {
      if (typeof value !== 'string' || !value.trim() || value.length > 256) {
        throw new TypeError(`budget reservations: ${name} must be a non-empty string of at most 256 characters`)
      }
    }
    if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(input.idempotencyKey)) {
      throw new TypeError('budget reservations: idempotencyKey must be a safe opaque identifier of at most 256 characters')
    }
    if (!['requests', 'tokens', 'bytes', 'operations'].includes(input.metric)) {
      throw new TypeError('budget reservations: unsupported metric')
    }
    if (!Number.isFinite(input.amount) || input.amount < 0 || !Number.isFinite(input.hardLimit) || input.hardLimit < 0) {
      throw new RangeError('budget reservations: amount and hardLimit must be finite non-negative numbers')
    }
    const nowMs = this.now()
    if (!Number.isFinite(nowMs)) throw new RangeError('budget reservations: clock must return a finite timestamp')
    const expiryMs = Date.parse(input.expiresAt)
    if (!Number.isFinite(expiryMs) || expiryMs <= nowMs || expiryMs - nowMs > this.maxReservationTtlMs) {
      throw new RangeError(`budget reservations: expiresAt must be in the future and within ${this.maxReservationTtlMs} ms`)
    }
    const expiresAt = new Date(expiryMs).toISOString()
    const payload = JSON.stringify({
      projectId: input.projectId,
      subjectId: input.subjectId,
      metric: input.metric,
      amount: input.amount,
      hardLimit: input.hardLimit,
      expiresAt,
    })
    return { nowMs, expiresAt, requestHash: createHash('sha256').update(payload, 'utf8').digest('hex') }
  }

  private query(db: SQLiteConnection, sql: string, values: readonly SQLiteValue[] = []): Record<string, unknown>[] {
    const statement = db.prepare(sql)
    try {
      if (values.length) statement.bind(values)
      const result: Record<string, unknown>[] = []
      while (statement.step()) result.push(statement.getAsObject())
      return result
    } finally {
      statement.free()
    }
  }

  private reservation(db: SQLiteConnection, id: string): BudgetReservation {
    const row = this.query(db, 'SELECT reservation_id, project_id, subject_id, metric, reserved_amount, state, expires_at FROM budget_reservations WHERE reservation_id = ?', [id])[0]
    if (!row) throw new BudgetReservationStoreError(`budget reservations: reservation ${id} does not exist`)
    return {
      reservationId: String(row['reservation_id']),
      projectId: String(row['project_id']),
      subjectId: String(row['subject_id']),
      metric: String(row['metric']) as BudgetReservation['metric'],
      reservedAmount: Number(row['reserved_amount']),
      state: String(row['state']) as BudgetReservation['state'],
      expiresAt: String(row['expires_at']),
    }
  }

  private cleanup(db: SQLiteConnection, now: string): void {
    db.run(
      "UPDATE budget_reservations SET state = 'expired', updated_at = ? WHERE state = 'reserved' AND expires_at <= ?",
      [now, now],
    )
    // Keep expired/released/settled reservation records for one additional
    // maximum-TTL window so a late settlement can still account actual usage.
    const cutoff = new Date(Date.parse(now) - this.maxReservationTtlMs).toISOString()
    db.run("DELETE FROM budget_reservations WHERE expires_at <= ? AND state IN ('expired', 'released', 'settled')", [cutoff])
    db.run('DELETE FROM budget_idempotency WHERE expires_at <= ?', [cutoff])
    db.run('DELETE FROM budget_settlements WHERE expires_at <= ?', [cutoff])
  }

  /**
   * Import one legacy JSON day snapshot exactly once. Existing usage or active
   * reservations are a conflict, never silently added to legacy counters.
   */
  async importLegacyDayUsage(input: {
    projectId: string
    day: string
    requests: number
    tokens: number
    requestHardLimit: number
    tokenHardLimit: number
    sourceHash: string
  }): Promise<{ imported: boolean }> {
    if (typeof input.projectId !== 'string' || !input.projectId.trim() || input.projectId.length > 256) {
      throw new TypeError('budget reservations: legacy import requires a valid projectId')
    }
    if (!validDayKey(input.day) || !validCount(input.requests) || !validCount(input.tokens) ||
        !validCount(input.requestHardLimit) || !validCount(input.tokenHardLimit) ||
        !/^[a-f0-9]{64}$/.test(input.sourceHash)) {
      throw new TypeError('budget reservations: legacy import payload is invalid')
    }
    await this.ready()
    const now = this.timestamp()
    return this.database.transaction((db) => {
      const existingImport = this.query(db,
        'SELECT source_hash FROM budget_legacy_imports WHERE project_id = ? AND day = ?',
        [input.projectId, input.day],
      )[0]
      if (existingImport) {
        if (String(existingImport['source_hash']) !== input.sourceHash) {
          throw new BudgetReservationStoreError('budget reservations: legacy day was already imported from different source contents')
        }
        return { imported: false }
      }
      const values = [
        { metric: 'requests', amount: input.requests, hardLimit: input.requestHardLimit },
        { metric: 'tokens', amount: input.tokens, hardLimit: input.tokenHardLimit },
      ] as const
      for (const value of values) {
        const subjectId = `day:${input.day}`
        const current = this.query(db,
          'SELECT committed_amount, hard_limit FROM budget_usage WHERE project_id = ? AND subject_id = ? AND metric = ?',
          [input.projectId, subjectId, value.metric],
        )[0]
        const active = this.query(db,
          "SELECT COUNT(*) AS count FROM budget_reservations WHERE project_id = ? AND subject_id = ? AND metric = ? AND state = 'reserved' AND expires_at > ?",
          [input.projectId, subjectId, value.metric, now],
        )[0]
        if ((current && Number(current['committed_amount']) !== 0) || Number(active?.['count'] ?? 0) > 0) {
          throw new BudgetReservationStoreError(`budget reservations: cannot import legacy ${value.metric}; shared usage already exists for ${subjectId}`)
        }
        if (current && Number(current['hard_limit']) !== value.hardLimit) {
          throw new BudgetReservationStoreError(`budget reservations: legacy ${value.metric} hard limit conflicts with existing shared policy`)
        }
        db.run(
          'INSERT INTO budget_usage (project_id, subject_id, metric, committed_amount, hard_limit) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, subject_id, metric) DO UPDATE SET committed_amount = excluded.committed_amount',
          [input.projectId, subjectId, value.metric, value.amount, value.hardLimit],
        )
      }
      db.run(
        'INSERT INTO budget_legacy_imports (project_id, day, source_hash, imported_at) VALUES (?, ?, ?, ?)',
        [input.projectId, input.day, input.sourceHash, now],
      )
      return { imported: true }
    })
  }

  /** Shared committed and currently-held usage for one project subject. */
  async usage(projectId: string, subjectId: string, metric: BudgetReservationRequest['metric']): Promise<{ committed: number; reserved: number; hardLimit?: number }> {
    if (typeof projectId !== 'string' || !projectId.trim() || typeof subjectId !== 'string' || !subjectId.trim()) {
      throw new TypeError('budget reservations: usage requires project and subject identifiers')
    }
    if (!['requests', 'tokens', 'bytes', 'operations'].includes(metric)) throw new TypeError('budget reservations: unsupported usage metric')
    await this.ready()
    const now = this.timestamp()
    return this.database.read((db) => {
      const usage = this.query(
        db,
        'SELECT committed_amount, hard_limit FROM budget_usage WHERE project_id = ? AND subject_id = ? AND metric = ?',
        [projectId, subjectId, metric],
      )[0]
      const held = this.query(
        db,
        "SELECT COALESCE(SUM(reserved_amount), 0) AS amount FROM budget_reservations WHERE project_id = ? AND subject_id = ? AND metric = ? AND state = 'reserved' AND expires_at > ?",
        [projectId, subjectId, metric, now],
      )[0]
      return {
        committed: usage ? Number(usage['committed_amount']) : 0,
        reserved: held ? Number(held['amount']) : 0,
        ...(usage ? { hardLimit: Number(usage['hard_limit']) } : {}),
      }
    })
  }

  async reserve(input: BudgetReservationRequest): Promise<ReservationDecision> {
    const validated = this.validateRequest(input)
    await this.ready()
    return this.database.transaction((db) => {
      const now = new Date(validated.nowMs).toISOString()
      this.cleanup(db, now)
      const existing = this.query(
        db,
        'SELECT request_hash, accepted, reservation_id, reason FROM budget_idempotency WHERE project_id = ? AND idempotency_key = ?',
        [input.projectId, input.idempotencyKey],
      )[0]
      if (existing) {
        if (String(existing['request_hash']) !== validated.requestHash) {
          return { accepted: false, reason: 'idempotency-conflict' }
        }
        if (Number(existing['accepted']) === 0) {
          return { accepted: false, reason: String(existing['reason']) as 'limit-exceeded' }
        }
        return { accepted: true, reservation: this.reservation(db, String(existing['reservation_id'])) }
      }

      let usage = this.query(
        db,
        'SELECT committed_amount, hard_limit FROM budget_usage WHERE project_id = ? AND subject_id = ? AND metric = ?',
        [input.projectId, input.subjectId, input.metric],
      )[0]
      if (!usage) {
        db.run(
          'INSERT INTO budget_usage (project_id, subject_id, metric, committed_amount, hard_limit) VALUES (?, ?, ?, 0, ?)',
          [input.projectId, input.subjectId, input.metric, input.hardLimit],
        )
        usage = { committed_amount: 0, hard_limit: input.hardLimit }
      } else if (Number(usage['hard_limit']) !== input.hardLimit) {
        throw new BudgetReservationStoreError('budget reservations: hard limit changed for an existing project/subject/metric; use a new subject id or perform an explicit migration')
      }
      const held = this.query(
        db,
        "SELECT COALESCE(SUM(reserved_amount), 0) AS amount FROM budget_reservations WHERE project_id = ? AND subject_id = ? AND metric = ? AND state = 'reserved' AND expires_at > ?",
        [input.projectId, input.subjectId, input.metric, now],
      )[0]
      const committed = usage ? Number(usage['committed_amount']) : 0
      const reserved = held ? Number(held['amount']) : 0
      const expiresAt = validated.expiresAt
      if (committed + reserved + input.amount > input.hardLimit) {
        db.run(
          'INSERT INTO budget_idempotency (project_id, idempotency_key, request_hash, accepted, reservation_id, reason, expires_at, created_at) VALUES (?, ?, ?, 0, NULL, ?, ?, ?)',
          [input.projectId, input.idempotencyKey, validated.requestHash, 'limit-exceeded', expiresAt, now],
        )
        return { accepted: false, reason: 'limit-exceeded' }
      }

      const reservationId = randomUUID()
      db.run(
        "INSERT INTO budget_reservations (reservation_id, project_id, subject_id, metric, reserved_amount, state, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?, ?)",
        [reservationId, input.projectId, input.subjectId, input.metric, input.amount, validated.expiresAt, now, now],
      )
      db.run(
        'INSERT INTO budget_idempotency (project_id, idempotency_key, request_hash, accepted, reservation_id, reason, expires_at, created_at) VALUES (?, ?, ?, 1, ?, NULL, ?, ?)',
        [input.projectId, input.idempotencyKey, validated.requestHash, reservationId, expiresAt, now],
      )
      return { accepted: true, reservation: this.reservation(db, reservationId) }
    })
  }

  async settle(input: BudgetSettlement): Promise<BudgetReservation> {
    if (!input || typeof input.reservationId !== 'string' || !input.reservationId.trim() ||
        typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(input.idempotencyKey) ||
        !Number.isFinite(input.actualAmount) || input.actualAmount < 0) {
      throw new TypeError('budget reservations: settlement requires a reservation id, idempotency key, and finite non-negative actualAmount')
    }
    await this.ready()
    return this.database.transaction((db) => {
      const row = this.query(
        db,
        'SELECT project_id, subject_id, metric, state, settlement_key, settlement_amount, expires_at FROM budget_reservations WHERE reservation_id = ?',
        [input.reservationId],
      )[0]
      if (!row) throw new BudgetReservationStoreError(`budget reservations: reservation ${input.reservationId} does not exist`)
      const projectId = String(row['project_id'])
      const requestHash = createHash('sha256').update(JSON.stringify({
        reservationId: input.reservationId,
        actualAmount: input.actualAmount,
      }), 'utf8').digest('hex')
      const existingSettlement = this.query(
        db,
        'SELECT request_hash FROM budget_settlements WHERE project_id = ? AND idempotency_key = ?',
        [projectId, input.idempotencyKey],
      )[0]
      if (existingSettlement) {
        if (String(existingSettlement['request_hash']) !== requestHash) {
          throw new BudgetReservationStoreError('budget reservations: settlement idempotency key was reused with a different command')
        }
        return this.reservation(db, input.reservationId)
      }
      const state = String(row['state'])
      if (state === 'settled') {
        if (row['settlement_key'] === input.idempotencyKey && Number(row['settlement_amount']) === input.actualAmount) {
          return this.reservation(db, input.reservationId)
        }
        throw new BudgetReservationStoreError('budget reservations: reservation was already settled with a different command')
      }
      if (state === 'released') throw new BudgetReservationStoreError('budget reservations: a released reservation cannot be settled')
      const now = this.timestamp()
      const usage = this.query(
        db,
        'SELECT committed_amount FROM budget_usage WHERE project_id = ? AND subject_id = ? AND metric = ?',
        [String(row['project_id']), String(row['subject_id']), String(row['metric'])],
      )[0]
      if (!usage) throw new BudgetReservationStoreError('budget reservations: committed usage aggregate is missing')
      if (!Number.isFinite(Number(usage['committed_amount']) + input.actualAmount)) {
        throw new BudgetReservationStoreError('budget reservations: committed usage would exceed the finite numeric range')
      }
      db.run(
        'UPDATE budget_usage SET committed_amount = committed_amount + ? WHERE project_id = ? AND subject_id = ? AND metric = ?',
        [input.actualAmount, String(row['project_id']), String(row['subject_id']), String(row['metric'])],
      )
      db.run(
        "UPDATE budget_reservations SET state = 'settled', actual_amount = ?, settlement_key = ?, settlement_amount = ?, updated_at = ? WHERE reservation_id = ?",
        [input.actualAmount, input.idempotencyKey, input.actualAmount, now, input.reservationId],
      )
      db.run(
        'INSERT INTO budget_settlements (project_id, idempotency_key, request_hash, reservation_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [projectId, input.idempotencyKey, requestHash, input.reservationId, String(row['expires_at']), now],
      )
      return this.reservation(db, input.reservationId)
    })
  }

  async release(reservationId: string, reason: string): Promise<BudgetReservation> {
    if (typeof reservationId !== 'string' || !reservationId.trim() || typeof reason !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(reason)) {
      throw new TypeError('budget reservations: release requires a reservation id and a short reason code (letters, digits, dot, underscore, colon, or hyphen)')
    }
    await this.ready()
    return this.database.transaction((db) => {
      const current = this.reservation(db, reservationId)
      if (current.state !== 'reserved') return current
      const now = this.timestamp()
      db.run(
        "UPDATE budget_reservations SET state = 'released', release_reason = ?, updated_at = ? WHERE reservation_id = ? AND state = 'reserved'",
        [reason, now, reservationId],
      )
      return this.reservation(db, reservationId)
    })
  }
}


export interface SQLiteLeaseStoreOptions { now?: () => number; maxLeaseTtlMs?: number }

/** SQLite-backed resource leases with monotonically increasing fencing tokens. */
export class SQLiteLeaseStore implements LeaseStore {
  private readonly database: SQLiteDatabase
  private readonly now: () => number
  private readonly maxLeaseTtlMs: number
  private readyPromise?: Promise<void>

  constructor(path: string, options: SQLiteLeaseStoreOptions = {}) {
    this.database = new SQLiteDatabase(path, BUDGET_RESERVATION_MIGRATIONS)
    this.now = options.now ?? Date.now
    this.maxLeaseTtlMs = options.maxLeaseTtlMs ?? 24 * 60 * 60 * 1000
    if (!Number.isSafeInteger(this.maxLeaseTtlMs) || this.maxLeaseTtlMs < 1_000 || this.maxLeaseTtlMs > 7 * 24 * 60 * 60 * 1000) throw new RangeError('leases: maxLeaseTtlMs must be from 1000 ms to 7 days')
  }

  private async ready(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = (async () => {
      const plan = await this.database.plan()
      if (plan.pending.length) {
        try { await this.database.apply(plan) }
        catch (error) {
          const current = await this.database.plan()
          if (current.pending.length) await this.database.apply(current)
          else if (current.currentVersion < current.targetVersion) throw error
        }
      }
      await this.database.verify()
    })()
    await this.readyPromise
  }

  private query(db: SQLiteConnection, sql: string, values: readonly SQLiteValue[] = []): Record<string, unknown>[] {
    const statement = db.prepare(sql)
    try {
      if (values.length) statement.bind(values)
      const result: Record<string, unknown>[] = []
      while (statement.step()) result.push(statement.getAsObject())
      return result
    } finally { statement.free() }
  }

  private lease(db: SQLiteConnection, id: string): Lease {
    const row = this.query(db, 'SELECT lease_id, project_id, resource_type, resource_id, owner_id, fencing_token, expires_at FROM resource_leases WHERE lease_id = ?', [id])[0]
    if (!row) throw new Error(`leases: lease ${id} does not exist`)
    return {
      leaseId: String(row['lease_id']), projectId: String(row['project_id']),
      resourceType: String(row['resource_type']) as Lease['resourceType'], resourceId: String(row['resource_id']),
      ownerId: String(row['owner_id']), fencingToken: Number(row['fencing_token']),
      expiresAt: new Date(Number(row['expires_at'])).toISOString(),
    }
  }

  async acquire(input: LeaseRequest): Promise<LeaseDecision> {
    if (!input || typeof input !== 'object') throw new TypeError('leases: request must be an object')
    for (const [name, value] of [['projectId', input.projectId], ['resourceId', input.resourceId], ['ownerId', input.ownerId], ['idempotencyKey', input.idempotencyKey]] as const) {
      if (typeof value !== 'string' || !value.trim() || value.length > 256 || (name === 'idempotencyKey' && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value))) throw new TypeError(`leases: invalid ${name}`)
    }
    if (!['workspace', 'job', 'index'].includes(input.resourceType)) throw new TypeError('leases: unsupported resource type')
    if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1 || input.ttlMs > this.maxLeaseTtlMs) throw new RangeError('leases: ttlMs exceeds configured bounds')
    const now = this.now()
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + input.ttlMs)) throw new RangeError('leases: invalid clock or expiry')
    const expiry = now + input.ttlMs
    const hash = createHash('sha256').update(JSON.stringify({ projectId: input.projectId, resourceType: input.resourceType, resourceId: input.resourceId, ownerId: input.ownerId, ttlMs: input.ttlMs }), 'utf8').digest('hex')
    await this.ready()
    return this.database.transaction((db) => {
      db.run("UPDATE resource_leases SET state = 'expired' WHERE state = 'active' AND expires_at <= ?", [now])
      db.run('DELETE FROM resource_lease_idempotency WHERE expires_at <= ?', [now])
      // Keep only a bounded grace window of terminal lease rows. Fencing
      // counters are deliberately retained so ownership tokens never reset.
      const leaseHistoryCutoff = now - this.maxLeaseTtlMs
      db.run("DELETE FROM resource_leases WHERE state IN ('released', 'expired') AND expires_at <= ?", [leaseHistoryCutoff])
      const prior = this.query(db, 'SELECT request_hash, lease_id FROM resource_lease_idempotency WHERE project_id = ? AND idempotency_key = ?', [input.projectId, input.idempotencyKey])[0]
      if (prior) {
        if (String(prior['request_hash']) !== hash) return { acquired: false, reason: 'idempotency-conflict' }
        if (prior['lease_id'] === null) return { acquired: false, reason: 'owned' }
        return { acquired: true, lease: this.lease(db, String(prior['lease_id'])) }
      }
      const current = this.query(db, "SELECT lease_id FROM resource_leases WHERE project_id = ? AND resource_type = ? AND resource_id = ? AND state = 'active' AND expires_at > ?", [input.projectId, input.resourceType, input.resourceId, now])[0]
      if (current) {
        db.run('INSERT INTO resource_lease_idempotency (project_id, idempotency_key, request_hash, lease_id, reason, expires_at) VALUES (?, ?, ?, NULL, ?, ?)', [input.projectId, input.idempotencyKey, hash, 'owned', expiry])
        return { acquired: false, reason: 'owned' }
      }
      const row = this.query(db, 'SELECT next_token FROM resource_lease_fences WHERE project_id = ? AND resource_type = ? AND resource_id = ?', [input.projectId, input.resourceType, input.resourceId])[0]
      const token = Number(row?.['next_token'] ?? 1)
      db.run('INSERT INTO resource_lease_fences (project_id, resource_type, resource_id, next_token) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, resource_type, resource_id) DO UPDATE SET next_token = excluded.next_token', [input.projectId, input.resourceType, input.resourceId, token + 1])
      const id = randomUUID()
      db.run("INSERT INTO resource_leases (lease_id, project_id, resource_type, resource_id, owner_id, fencing_token, expires_at, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)", [id, input.projectId, input.resourceType, input.resourceId, input.ownerId, token, expiry, now])
      db.run('INSERT INTO resource_lease_idempotency (project_id, idempotency_key, request_hash, lease_id, reason, expires_at) VALUES (?, ?, ?, ?, NULL, ?)', [input.projectId, input.idempotencyKey, hash, id, expiry])
      return { acquired: true, lease: this.lease(db, id) }
    })
  }

  async renew(leaseId: string, ownerId: string, fencingToken: number, ttlMs: number): Promise<Lease> {
    if (!leaseId.trim() || !ownerId.trim() || !Number.isSafeInteger(fencingToken) || fencingToken < 1 || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > this.maxLeaseTtlMs) throw new TypeError('leases: invalid renewal arguments')
    const now = this.now()
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(now + ttlMs)) throw new RangeError('leases: invalid clock or expiry')
    await this.ready()
    return this.database.transaction((db) => {
      const current = this.query(db, "SELECT lease_id FROM resource_leases WHERE lease_id = ? AND owner_id = ? AND fencing_token = ? AND state = 'active' AND expires_at > ?", [leaseId, ownerId, fencingToken, now])[0]
      if (!current) throw new Error('leases: stale or expired owner cannot renew')
      db.run('UPDATE resource_leases SET expires_at = ? WHERE lease_id = ?', [now + ttlMs, leaseId])
      return this.lease(db, leaseId)
    })
  }

  async release(leaseId: string, ownerId: string, fencingToken: number): Promise<void> {
    if (!leaseId.trim() || !ownerId.trim() || !Number.isSafeInteger(fencingToken) || fencingToken < 1) throw new TypeError('leases: invalid release arguments')
    const now = this.now()
    await this.ready()
    await this.database.transaction((db) => {
      db.run("UPDATE resource_leases SET state = 'released' WHERE lease_id = ? AND owner_id = ? AND fencing_token = ? AND state = 'active' AND expires_at > ?", [leaseId, ownerId, fencingToken, now])
    })
  }

  async isCurrent(leaseId: string, ownerId: string, fencingToken: number): Promise<boolean> {
    if (!leaseId.trim() || !ownerId.trim() || !Number.isSafeInteger(fencingToken) || fencingToken < 1) return false
    const now = this.now()
    await this.ready()
    return this.database.read((db) => this.query(db, "SELECT lease_id FROM resource_leases WHERE lease_id = ? AND owner_id = ? AND fencing_token = ? AND state = 'active' AND expires_at > ?", [leaseId, ownerId, fencingToken, now]).length > 0)
  }
}
