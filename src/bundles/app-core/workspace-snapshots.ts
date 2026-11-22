import { createHash } from 'node:crypto'
import type {
  WorkspaceSnapshotManifest,
  WorkspaceSnapshotStore,
  WorkspaceTransferLimits,
} from '../../architecture/contracts.js'
import { workspaceManifestSha256, validateWorkspaceSnapshotManifest } from './workspace-transfer.js'
import { BUDGET_RESERVATION_MIGRATIONS } from './budgets.js'
import { SQLiteDatabase, type SQLiteConnection, type SQLiteValue, type SQLiteDatabaseOptions } from '../../util/sqlite.js'

export interface SQLiteWorkspaceSnapshotStoreOptions extends SQLiteDatabaseOptions {
  readonly now?: () => number
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

function required(name: string, value: unknown, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value !== value.trim()) {
    throw new TypeError(`workspace snapshot store: invalid ${name}`)
  }
  return value
}

function positiveFence(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('workspace snapshot store: fencingToken must be a positive integer')
}

function canonicalTime(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || new Date(parsed).toISOString() !== value) {
    throw new TypeError('workspace snapshot store: invalid manifest timestamp')
  }
  return parsed
}

/** Durable mapping from a provider snapshot ID to the exact validated manifest and creating fence. */
export class SQLiteWorkspaceSnapshotStore implements WorkspaceSnapshotStore {
  private readonly database: SQLiteDatabase
  private readonly now: () => number
  private readyPromise?: Promise<void>

  constructor(path: string, options: SQLiteWorkspaceSnapshotStoreOptions = {}) {
    this.database = new SQLiteDatabase(path, BUDGET_RESERVATION_MIGRATIONS, options)
    this.now = options.now ?? Date.now
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

  async save(input: {
    readonly workspaceId: string
    readonly ownerId: string
    readonly leaseId: string
    readonly fencingToken: number
    readonly manifest: WorkspaceSnapshotManifest
    readonly limits: WorkspaceTransferLimits
  }): Promise<void> {
    const workspaceId = required('workspaceId', input.workspaceId)
    const ownerId = required('ownerId', input.ownerId)
    const leaseId = required('leaseId', input.leaseId)
    positiveFence(input.fencingToken)
    if (!input.manifest || typeof input.manifest !== 'object') throw new TypeError('workspace snapshot store: manifest is required')
    validateWorkspaceSnapshotManifest(input.manifest, input.limits)
    const manifest = input.manifest
    const createdAt = canonicalTime(manifest.createdAt)
    const now = this.now()
    if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('workspace snapshot store: clock must return a non-negative safe integer')
    if (createdAt > now) throw new RangeError('workspace snapshot store: manifest timestamp is in the future')
    const json = JSON.stringify(manifest)
    const manifestHash = createHash('sha256').update(json, 'utf8').digest('hex')
    await this.ready()
    await this.database.transaction((db) => {
      const session = query(db, `SELECT s.project_id, s.task_id, s.owner_id, s.lease_id, s.fencing_token, s.expires_at, s.state\n        FROM workspace_sessions s JOIN resource_leases l ON l.lease_id = s.lease_id\n        WHERE s.workspace_id = ? AND l.owner_id = s.owner_id AND l.fencing_token = s.fencing_token\n          AND l.state = 'active' AND l.expires_at > ?`, [workspaceId, now])[0]
      if (!session || String(session['project_id']) !== manifest.projectId || String(session['task_id']) !== manifest.taskId ||
          String(session['owner_id']) !== ownerId || String(session['lease_id']) !== leaseId ||
          Number(session['fencing_token']) !== input.fencingToken || Number(session['expires_at']) <= now ||
          !['ready', 'transferring'].includes(String(session['state']))) {
        throw new Error('workspace snapshot store: manifest does not belong to the current ready workspace fence')
      }
      const prior = query(db, 'SELECT owner_id, lease_id, fencing_token, manifest_json, manifest_sha256 FROM workspace_snapshots WHERE workspace_id = ? AND snapshot_id = ?', [workspaceId, manifest.snapshotId])[0]
      if (prior) {
        const same = String(prior['owner_id']) === ownerId && String(prior['lease_id']) === leaseId &&
          Number(prior['fencing_token']) === input.fencingToken && String(prior['manifest_json']) === json &&
          String(prior['manifest_sha256']) === manifestHash
        if (!same) throw new Error('workspace snapshot store: snapshot ID already exists with different manifest or fence')
        return
      }
      db.run(
        'INSERT INTO workspace_snapshots (workspace_id, snapshot_id, project_id, task_id, owner_id, lease_id, fencing_token, manifest_json, manifest_sha256, total_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [workspaceId, manifest.snapshotId, manifest.projectId, manifest.taskId, ownerId, leaseId, input.fencingToken, json, manifestHash, manifest.totalBytes, createdAt],
      )
    })
  }

  async get(workspaceIdValue: string, snapshotIdValue: string): Promise<WorkspaceSnapshotManifest | undefined> {
    const workspaceId = required('workspaceId', workspaceIdValue)
    const snapshotId = required('snapshotId', snapshotIdValue)
    await this.ready()
    return this.database.read((db) => {
      const row = query(db, 'SELECT manifest_json, manifest_sha256 FROM workspace_snapshots WHERE workspace_id = ? AND snapshot_id = ?', [workspaceId, snapshotId])[0]
      if (!row) return undefined
      const json = String(row['manifest_json'])
      const digest = createHash('sha256').update(json, 'utf8').digest('hex')
      if (digest !== String(row['manifest_sha256'])) throw new Error('workspace snapshot store: persisted manifest record checksum mismatch')
      let manifest: WorkspaceSnapshotManifest
      try { manifest = JSON.parse(json) as WorkspaceSnapshotManifest }
      catch { throw new Error('workspace snapshot store: persisted manifest JSON is corrupt') }
      if (!manifest || manifest.snapshotId !== snapshotId || workspaceManifestSha256(manifest) !== manifest.manifestSha256) {
        throw new Error('workspace snapshot store: persisted manifest payload digest mismatch')
      }
      return manifest
    })
  }

  async list(workspaceIdValue: string, limit = 20): Promise<readonly WorkspaceSnapshotManifest[]> {
    const workspaceId = required('workspaceId', workspaceIdValue)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError('workspace snapshot store: list limit must be from 1 to 100')
    await this.ready()
    const ids = await this.database.read((db) => query(db,
      'SELECT snapshot_id FROM workspace_snapshots WHERE workspace_id = ? ORDER BY created_at DESC, snapshot_id DESC LIMIT ?',
      [workspaceId, limit],
    ).map((row) => String(row['snapshot_id'])))
    const manifests: WorkspaceSnapshotManifest[] = []
    for (const id of ids) {
      const manifest = await this.get(workspaceId, id)
      if (manifest) manifests.push(manifest)
    }
    return manifests
  }

  async delete(input: {
    readonly workspaceId: string
    readonly snapshotId: string
    readonly ownerId: string
    readonly leaseId: string
    readonly fencingToken: number
  }): Promise<boolean> {
    const workspaceId = required('workspaceId', input.workspaceId)
    const snapshotId = required('snapshotId', input.snapshotId)
    const ownerId = required('ownerId', input.ownerId)
    const leaseId = required('leaseId', input.leaseId)
    positiveFence(input.fencingToken)
    const now = this.now()
    if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('workspace snapshot store: clock must return a non-negative safe integer')
    await this.ready()
    return this.database.transaction((db) => {
      const session = query(db, `SELECT s.owner_id, s.lease_id, s.fencing_token, s.expires_at, s.state\n        FROM workspace_sessions s JOIN resource_leases l ON l.lease_id = s.lease_id\n        WHERE s.workspace_id = ? AND l.owner_id = s.owner_id AND l.fencing_token = s.fencing_token\n          AND l.state = 'active' AND l.expires_at > ?`, [workspaceId, now])[0]
      if (!session || String(session['owner_id']) !== ownerId || String(session['lease_id']) !== leaseId ||
          Number(session['fencing_token']) !== input.fencingToken || Number(session['expires_at']) <= now ||
          !['ready', 'transferring'].includes(String(session['state']))) {
        throw new Error('workspace snapshot store: stale owner cannot delete snapshot metadata')
      }
      const prior = query(db, 'SELECT snapshot_id FROM workspace_snapshots WHERE workspace_id = ? AND snapshot_id = ?', [workspaceId, snapshotId])[0]
      if (!prior) return false
      db.run('DELETE FROM workspace_snapshots WHERE workspace_id = ? AND snapshot_id = ?', [workspaceId, snapshotId])
      return true
    })
  }
}
