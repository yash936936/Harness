import { createHash } from 'node:crypto'
import type {
  WorkspaceCapability,
  WorkspaceOperation,
  WorkspaceSession,
  WorkspaceSessionStore,
  WorkspaceSessionTransition,
} from '../../architecture/contracts.js'
import { SQLiteDatabase, type SQLiteConnection, type SQLiteValue, type SQLiteDatabaseOptions } from '../../util/sqlite.js'
import { BUDGET_RESERVATION_MIGRATIONS } from './budgets.js'

export interface SQLiteWorkspaceStoreOptions extends SQLiteDatabaseOptions {
  readonly now?: () => number
}

const SESSION_STATES = new Set<WorkspaceSession['state']>([
  'creating', 'ready', 'transferring', 'running', 'closing', 'closed', 'failed', 'unknown',
])
const OPERATIONS = new Set<WorkspaceOperation>(['list', 'read', 'write', 'execute', 'collect'])
const TRANSITIONS: Readonly<Record<WorkspaceSession['state'], readonly WorkspaceSession['state'][]>> = {
  creating: ['ready', 'failed', 'closing', 'unknown'],
  ready: ['transferring', 'running', 'closing', 'failed', 'unknown'],
  transferring: ['ready', 'failed', 'closing', 'unknown'],
  running: ['ready', 'failed', 'closing', 'unknown'],
  closing: ['closed', 'failed', 'unknown'],
  closed: [],
  failed: ['closing', 'closed'],
  unknown: ['ready', 'closing', 'failed', 'closed'],
}

function query(db: SQLiteConnection, sql: string, values: readonly SQLiteValue[] = []): Record<string, unknown>[] {
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

function requiredString(name: string, value: unknown, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError(`workspace store: invalid ${name}`)
  return value
}

function timestamp(name: string, value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError(`workspace store: invalid ${name}`)
  return parsed
}

function canonicalPath(value: string, allowRoot = false): string | undefined {
  if (typeof value !== 'string' || value.length > 1024 || value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return undefined
  if (value === '') return allowRoot ? '' : undefined
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return undefined
  return value
}

function pathWithin(path: string, prefix: string): boolean {
  return prefix === '' || path === prefix || path.startsWith(`${prefix}/`)
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function toSession(row: Record<string, unknown>): WorkspaceSession {
  return {
    workspaceId: String(row['workspace_id']),
    projectId: String(row['project_id']),
    taskId: String(row['task_id']),
    sessionId: String(row['session_id']),
    provider: String(row['provider']),
    state: String(row['state']) as WorkspaceSession['state'],
    leaseId: String(row['lease_id']),
    fencingToken: Number(row['fencing_token']),
    createdAt: new Date(Number(row['created_at'])).toISOString(),
    expiresAt: new Date(Number(row['expires_at'])).toISOString(),
  }
}

/**
 * Durable task-scoped workspace metadata. This store never persists raw
 * capability tokens. Lease liveness remains the responsibility of
 * LeaseStore.isCurrent; transitions additionally compare the stored lease
 * identity and fencing token so stale owners cannot mutate session state.
 */
export class SQLiteWorkspaceStore implements WorkspaceSessionStore {
  private readonly database: SQLiteDatabase
  private readonly now: () => number
  private readyPromise?: Promise<void>

  constructor(path: string, options: SQLiteWorkspaceStoreOptions = {}) {
    this.database = new SQLiteDatabase(path, BUDGET_RESERVATION_MIGRATIONS, options)
    this.now = options.now ?? Date.now
  }

  private currentTime(): number {
    const value = this.now()
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('workspace store: clock must return a non-negative safe integer')
    return value
  }

  private async ready(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = (async () => {
      const plan = await this.database.plan()
      if (plan.pending.length) {
        try {
          await this.database.apply(plan)
        } catch (error) {
          const current = await this.database.plan()
          if (current.pending.length) await this.database.apply(current)
          else if (current.currentVersion < current.targetVersion) throw error
        }
      }
      await this.database.verify()
    })()
    await this.readyPromise
  }

  async createSession(input: WorkspaceSession & { readonly ownerId: string; readonly idempotencyKey: string }): Promise<WorkspaceSession> {
    const workspaceId = requiredString('workspaceId', input.workspaceId)
    const projectId = requiredString('projectId', input.projectId)
    const taskId = requiredString('taskId', input.taskId)
    const sessionId = requiredString('sessionId', input.sessionId)
    const provider = requiredString('provider', input.provider, 128)
    const ownerId = requiredString('ownerId', input.ownerId)
    const leaseId = requiredString('leaseId', input.leaseId)
    const idempotencyKey = requiredString('idempotencyKey', input.idempotencyKey)
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(idempotencyKey)) throw new TypeError('workspace store: invalid idempotencyKey')
    if (input.state !== 'creating') throw new TypeError('workspace store: new sessions must start in creating state')
    if (!Number.isSafeInteger(input.fencingToken) || input.fencingToken < 1) throw new RangeError('workspace store: fencingToken must be a positive integer')
    const createdAt = timestamp('createdAt', input.createdAt)
    const expiresAt = timestamp('expiresAt', input.expiresAt)
    if (expiresAt <= createdAt || expiresAt <= this.currentTime()) throw new RangeError('workspace store: expiresAt must be in the future and after createdAt')
    const requestHash = createHash('sha256').update(JSON.stringify({
      workspaceId, projectId, taskId, sessionId, provider, ownerId, leaseId,
      fencingToken: input.fencingToken, createdAt, expiresAt,
    }), 'utf8').digest('hex')
    await this.ready()
    return this.database.transaction((db) => {
      const prior = query(db, 'SELECT request_hash, workspace_id FROM workspace_session_idempotency WHERE project_id = ? AND idempotency_key = ?', [projectId, idempotencyKey])[0]
      if (prior) {
        if (String(prior['request_hash']) !== requestHash) throw new Error('workspace store: idempotency key reused with different session input')
        const row = query(db, 'SELECT * FROM workspace_sessions WHERE workspace_id = ?', [String(prior['workspace_id'])])[0]
        if (!row) throw new Error('workspace store: idempotency record references a missing session')
        return toSession(row)
      }
      const existing = query(db, 'SELECT * FROM workspace_sessions WHERE project_id = ? AND task_id = ? AND session_id = ?', [projectId, taskId, sessionId])[0]
      if (existing) throw new Error('workspace store: task session already exists')
      db.run(
        'INSERT INTO workspace_sessions (workspace_id, project_id, task_id, session_id, provider, state, owner_id, lease_id, fencing_token, created_at, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [workspaceId, projectId, taskId, sessionId, provider, 'creating', ownerId, leaseId, input.fencingToken, createdAt, expiresAt, this.now()],
      )
      db.run(
        'INSERT INTO workspace_session_idempotency (project_id, idempotency_key, request_hash, workspace_id, created_at) VALUES (?, ?, ?, ?, ?)',
        [projectId, idempotencyKey, requestHash, workspaceId, this.currentTime()],
      )
      const row = query(db, 'SELECT * FROM workspace_sessions WHERE workspace_id = ?', [workspaceId])[0]
      if (!row) throw new Error('workspace store: session insert was not visible')
      return toSession(row)
    })
  }

  async getSession(workspaceId: string): Promise<WorkspaceSession | undefined> {
    requiredString('workspaceId', workspaceId)
    await this.ready()
    return this.database.read((db) => {
      const row = query(db, 'SELECT * FROM workspace_sessions WHERE workspace_id = ?', [workspaceId])[0]
      return row ? toSession(row) : undefined
    })
  }

  async getTaskSession(projectId: string, taskId: string, sessionId: string): Promise<WorkspaceSession | undefined> {
    requiredString('projectId', projectId)
    requiredString('taskId', taskId)
    requiredString('sessionId', sessionId)
    await this.ready()
    return this.database.read((db) => {
      const row = query(db, 'SELECT * FROM workspace_sessions WHERE project_id = ? AND task_id = ? AND session_id = ?', [projectId, taskId, sessionId])[0]
      return row ? toSession(row) : undefined
    })
  }

  async listSessions(projectId: string, states?: readonly WorkspaceSession['state'][], limit = 100): Promise<readonly WorkspaceSession[]> {
    requiredString('projectId', projectId)
    if (states && states.some((state) => !SESSION_STATES.has(state))) throw new TypeError('workspace store: invalid session state filter')
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new RangeError('workspace store: session list limit must be from 1 to 1000')
    await this.ready()
    return this.database.read((db) => {
      const rows = states?.length
        ? query(db, `SELECT * FROM workspace_sessions WHERE project_id = ? AND state IN (${states.map(() => '?').join(',')}) ORDER BY created_at, workspace_id LIMIT ?`, [projectId, ...states, limit])
        : states
          ? []
          : query(db, 'SELECT * FROM workspace_sessions WHERE project_id = ? ORDER BY created_at, workspace_id LIMIT ?', [projectId, limit])
      return rows.map(toSession)
    })
  }

  async transitionSession(input: WorkspaceSessionTransition): Promise<WorkspaceSession> {
    requiredString('workspaceId', input.workspaceId)
    requiredString('ownerId', input.ownerId)
    requiredString('leaseId', input.leaseId)
    if (!Number.isSafeInteger(input.fencingToken) || input.fencingToken < 1) throw new RangeError('workspace store: invalid fencing token')
    if (!SESSION_STATES.has(input.expectedState) || !SESSION_STATES.has(input.nextState)) throw new TypeError('workspace store: invalid transition state')
    if (!TRANSITIONS[input.expectedState].includes(input.nextState)) throw new Error(`workspace store: transition ${input.expectedState} -> ${input.nextState} is not allowed`)
    const expiresAt = input.expiresAt === undefined ? undefined : timestamp('expiresAt', input.expiresAt)
    const now = this.currentTime()
    if (expiresAt !== undefined && expiresAt <= now) throw new RangeError('workspace store: transitioned session expiry must be in the future')
    await this.ready()
    return this.database.transaction((db) => {
      const values: SQLiteValue[] = [input.nextState, now]
      let sql = 'UPDATE workspace_sessions SET state = ?, updated_at = ?'
      if (expiresAt !== undefined) {
        sql += ', expires_at = ?'
        values.push(expiresAt)
      }
      sql += ' WHERE workspace_id = ? AND owner_id = ? AND lease_id = ? AND fencing_token = ? AND state = ?'
      values.push(input.workspaceId, input.ownerId, input.leaseId, input.fencingToken, input.expectedState)
      db.run(sql, values)
      const row = query(db, 'SELECT * FROM workspace_sessions WHERE workspace_id = ?', [input.workspaceId])[0]
      if (!row) throw new Error('workspace store: session does not exist')
      if (String(row['state']) !== input.nextState || Number(row['fencing_token']) !== input.fencingToken || String(row['owner_id']) !== input.ownerId || String(row['lease_id']) !== input.leaseId || (expiresAt !== undefined && Number(row['expires_at']) !== expiresAt)) {
        throw new Error('workspace store: stale owner or unexpected session state')
      }
      if (input.nextState === 'closed' || input.nextState === 'failed') {
        db.run('UPDATE workspace_capabilities SET revoked_at = COALESCE(revoked_at, ?), revoke_reason = COALESCE(revoke_reason, ?) WHERE workspace_id = ?', [now, input.nextState, input.workspaceId])
      }
      return toSession(row)
    })
  }

  async recordCapability(capability: WorkspaceCapability): Promise<void> {
    const token = requiredString('capability token', capability.token, 4096)
    if (token.length < 16) throw new TypeError('workspace store: capability token is too short')
    const capabilityId = requiredString('capabilityId', capability.capabilityId)
    const workspaceId = requiredString('workspaceId', capability.workspaceId)
    const projectId = requiredString('projectId', capability.projectId)
    const taskId = requiredString('taskId', capability.taskId)
    const sessionId = requiredString('sessionId', capability.sessionId)
    if (!Array.isArray(capability.operations) || capability.operations.length === 0 || capability.operations.some((op) => !OPERATIONS.has(op))) {
      throw new TypeError('workspace store: invalid capability operations')
    }
    if (!Array.isArray(capability.pathPrefixes) || capability.pathPrefixes.length > 128) throw new TypeError('workspace store: pathPrefixes must be an array of at most 128 entries')
    const prefixes = capability.pathPrefixes.map((prefix) => canonicalPath(prefix, true))
    if (prefixes.some((prefix) => prefix === undefined) || new Set(prefixes).size !== prefixes.length) throw new TypeError('workspace store: pathPrefixes must be canonical and unique')
    const expiresAt = timestamp('capability expiresAt', capability.expiresAt)
    const now = this.now()
    if (expiresAt <= now) throw new RangeError('workspace store: capability is already expired')
    await this.ready()
    await this.database.transaction((db) => {
      const session = query(db, 'SELECT project_id, task_id, session_id, state, expires_at FROM workspace_sessions WHERE workspace_id = ?', [workspaceId])[0]
      if (!session || String(session['project_id']) !== projectId || String(session['task_id']) !== taskId || String(session['session_id']) !== sessionId) {
        throw new Error('workspace store: capability does not match a stored task session')
      }
      if (!['ready', 'transferring', 'running'].includes(String(session['state'])) || expiresAt > Number(session['expires_at'])) {
        throw new Error('workspace store: capability exceeds session state or expiry')
      }
      const tokenHash = hashToken(token)
      const prior = query(db, 'SELECT token_hash, workspace_id, project_id, task_id, session_id, operations_json, path_prefixes_json, expires_at FROM workspace_capabilities WHERE capability_id = ?', [capabilityId])[0]
      if (prior) {
        const same = String(prior['token_hash']) === tokenHash && String(prior['workspace_id']) === workspaceId &&
          String(prior['project_id']) === projectId && String(prior['task_id']) === taskId && String(prior['session_id']) === sessionId &&
          String(prior['operations_json']) === JSON.stringify([...new Set(capability.operations)]) &&
          String(prior['path_prefixes_json']) === JSON.stringify(prefixes) && Number(prior['expires_at']) === expiresAt
        if (!same) throw new Error('workspace store: capability ID already exists with different scope')
        return
      }
      db.run(
        'INSERT INTO workspace_capabilities (capability_id, token_hash, workspace_id, project_id, task_id, session_id, operations_json, path_prefixes_json, expires_at, revoked_at, revoke_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)',
        [capabilityId, tokenHash, workspaceId, projectId, taskId, sessionId, JSON.stringify([...new Set(capability.operations)]), JSON.stringify(prefixes), expiresAt, now],
      )
    })
  }

  async authorizeCapability(input: {
    readonly token: string
    readonly projectId: string
    readonly taskId: string
    readonly sessionId: string
    readonly workspaceId: string
    readonly operation: WorkspaceOperation
    readonly path?: string
    readonly now?: number
  }): Promise<boolean> {
    if (typeof input.token !== 'string' || input.token.length < 16 || input.token.length > 4096) return false
    if (!OPERATIONS.has(input.operation)) return false
    const path = input.path === undefined ? undefined : canonicalPath(input.path, true)
    if (input.path !== undefined && path === undefined) return false
    if (path === undefined && input.operation !== 'collect') return false
    const now = input.now ?? this.currentTime()
    if (!Number.isSafeInteger(now) || now < 0) return false
    await this.ready()
    return this.database.read((db) => {
      const row = query(db, `SELECT c.operations_json, c.path_prefixes_json
        FROM workspace_capabilities c
        JOIN workspace_sessions s ON s.workspace_id = c.workspace_id
        WHERE c.token_hash = ? AND c.workspace_id = ? AND c.project_id = ? AND c.task_id = ? AND c.session_id = ?
          AND c.expires_at > ? AND c.revoked_at IS NULL AND s.expires_at > ? AND s.state IN ('ready', 'transferring', 'running')`,
      [hashToken(input.token), input.workspaceId, input.projectId, input.taskId, input.sessionId, now, now])[0]
      if (!row) return false
      let operations: unknown
      let prefixes: unknown
      try {
        operations = JSON.parse(String(row['operations_json']))
        prefixes = JSON.parse(String(row['path_prefixes_json']))
      } catch { return false }
      if (!Array.isArray(operations) || !operations.includes(input.operation) || !Array.isArray(prefixes)) return false
      if (input.operation === 'collect' && path === undefined) return true
      return path !== undefined && prefixes.some((prefix) => typeof prefix === 'string' && canonicalPath(prefix, true) !== undefined && pathWithin(path, prefix))
    })
  }

  async revokeCapability(capabilityId: string, reason: string): Promise<void> {
    requiredString('capabilityId', capabilityId)
    requiredString('revocation reason', reason, 512)
    const now = this.now()
    await this.ready()
    await this.database.transaction((db) => {
      db.run('UPDATE workspace_capabilities SET revoked_at = COALESCE(revoked_at, ?), revoke_reason = COALESCE(revoke_reason, ?) WHERE capability_id = ?', [now, reason, capabilityId])
    })
  }

  async revokeWorkspaceCapabilities(workspaceId: string, reason: string): Promise<void> {
    requiredString('workspaceId', workspaceId)
    requiredString('revocation reason', reason, 512)
    const now = this.now()
    await this.ready()
    await this.database.transaction((db) => {
      db.run('UPDATE workspace_capabilities SET revoked_at = COALESCE(revoked_at, ?), revoke_reason = COALESCE(revoke_reason, ?) WHERE workspace_id = ?', [now, reason, workspaceId])
    })
  }
}
