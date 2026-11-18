import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, open, rename, unlink, lstat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { withFileLock, type LockOptions } from './filelock.js'
import { assertNoSymlinkParents, readBufferFileNoFollow } from './secure-file.js'
import type { AppliedMigration, MigrationCoordinator, MigrationPlan } from '../architecture/contracts.js'

export type SQLiteValue = string | number | null | Uint8Array

export interface SQLiteStatement {
  bind(values?: readonly SQLiteValue[]): boolean
  step(): boolean
  getAsObject(): Record<string, unknown>
  free(): void
}

export interface SQLiteConnection {
  run(sql: string, values?: readonly SQLiteValue[]): void
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>
  prepare(sql: string): SQLiteStatement
  export(): Uint8Array
  close(): void
}

interface SQLiteEngine {
  Database: new (data?: Uint8Array) => SQLiteConnection
}

type SQLiteInitializer = (options?: { locateFile?: (file: string) => string }) => Promise<SQLiteEngine>

export interface SQLiteMigration {
  readonly version: number
  readonly id: string
  readonly sql: string
}

export interface SQLiteDatabaseOptions {
  /** Cross-process file-lock bounds. The default is 10 seconds. */
  readonly lock?: LockOptions
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex')
}

function rows(db: SQLiteConnection, sql: string, values: readonly SQLiteValue[] = []): Record<string, unknown>[] {
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

function isMissing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

function samePlan(left: MigrationPlan, right: MigrationPlan): boolean {
  return left.currentVersion === right.currentVersion &&
    left.targetVersion === right.targetVersion &&
    left.pending.length === right.pending.length &&
    left.pending.every((item, index) => {
      const other = right.pending[index]
      return !!other && item.version === other.version && item.id === other.id && item.checksum === other.checksum
    })
}

const LEDGER_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  id TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`

/**
 * File-backed SQLite for small shared coordination state.
 *
 * sql.js is SQLite compiled to WebAssembly. Each write reloads the database
 * while holding the repository's cross-process local-filesystem lock, runs a
 * SQLite transaction, exports to a unique temporary file, and atomically
 * replaces the database. Readers use the same lock whenever the database file
 * exists so Windows can safely replace it without an open reader handle. A
 * read of a not-yet-created database returns an empty snapshot without creating
 * directories. This serializes file access across processes and avoids native
 * SQLite binaries across the supported Windows/Linux matrix.
 *
 * This is intended for bounded coordination metadata, not large event or
 * vector stores: every write reloads and exports the complete database.
 */
export class SQLiteDatabase implements MigrationCoordinator {
  readonly path: string
  private readonly lockOptions: LockOptions
  private readonly migrations: readonly (SQLiteMigration & { checksum: string })[]
  private enginePromise?: Promise<SQLiteEngine>

  constructor(path: string, migrations: readonly SQLiteMigration[] = [], options: SQLiteDatabaseOptions = {}) {
    if (typeof path !== 'string' || !path.trim()) throw new TypeError('sqlite: database path must be a non-empty string')
    this.path = resolve(path)
    this.lockOptions = options.lock ?? {}
    const seenIds = new Set<string>()
    this.migrations = migrations.map((migration, index) => {
      if (!Number.isSafeInteger(migration.version) || migration.version !== index + 1) {
        throw new RangeError('sqlite: migrations must have unique, contiguous versions starting at 1')
      }
      if (typeof migration.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(migration.id) || seenIds.has(migration.id)) {
        throw new TypeError(`sqlite: migration ${migration.version} must have a unique, valid id`)
      }
      if (typeof migration.sql !== 'string' || !migration.sql.trim()) {
        throw new TypeError(`sqlite: migration ${migration.version} must contain SQL`)
      }
      seenIds.add(migration.id)
      return Object.freeze({ ...migration, checksum: checksum(migration.sql) })
    })
  }

  private engine(): Promise<SQLiteEngine> {
    if (!this.enginePromise) {
      this.enginePromise = (async () => {
        const loaded = await import('sql.js' as string) as unknown as { default?: SQLiteInitializer }
        const initialize = loaded.default
        if (typeof initialize !== 'function') throw new Error('sqlite: sql.js did not expose its initializer')
        const require = createRequire(import.meta.url)
        const entry = require.resolve('sql.js')
        return initialize({ locateFile: (file) => join(dirname(entry), file) })
      })()
    }
    return this.enginePromise
  }

  private async load(): Promise<SQLiteConnection> {
    const engine = await this.engine()
    try {
      const bytes = await readBufferFileNoFollow(this.path)
      return new engine.Database(new Uint8Array(bytes))
    } catch (error) {
      if (!isMissing(error)) throw error
      return new engine.Database()
    }
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await assertNoSymlinkParents(this.path)
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    await assertNoSymlinkParents(this.path)
    return withFileLock(`${this.path}.lock`, fn, this.lockOptions)
  }

  private async persist(bytes: Uint8Array): Promise<void> {
    await assertNoSymlinkParents(this.path)
    try {
      const current = await lstat(this.path)
      if (!current.isFile() || current.isSymbolicLink()) {
        throw new Error(`sqlite: database path is not a regular file: ${this.path}`)
      }
    } catch (error) {
      if (!isMissing(error)) throw error
    }

    const temporary = `${this.path}.tmp-${process.pid}-${randomUUID()}`
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(bytes)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await assertNoSymlinkParents(this.path)
      await rename(temporary, this.path)
    } catch (error) {
      await unlink(temporary).catch(() => {})
      throw error
    }
  }

  /** Execute a read-only callback against one consistent database snapshot. */
  async read<T>(fn: (db: SQLiteConnection) => T | Promise<T>): Promise<T> {
    // A missing database is a consistent empty snapshot. Avoid creating its
    // parent directory for read-only planning. Once the file exists, readers
    // must share the writer lock: Windows refuses to rename over a file while
    // another process still has an open read handle.
    try {
      await lstat(this.path)
    } catch (error) {
      if (!isMissing(error)) throw error
      // The ENOENT observation is this read's linearization point. Do
      // not re-open the path here: another process may create and atomically
      // replace the database immediately after the lstat, making a second
      // path-based open spuriously look like a symlink/TOCTOU attack.
      await assertNoSymlinkParents(this.path)
      const engine = await this.engine()
      const empty = new engine.Database()
      try {
        return await fn(empty)
      } finally {
        empty.close()
      }
    }
    return this.withLock(async () => {
      const db = await this.load()
      try {
        return await fn(db)
      } finally {
        db.close()
      }
    })
  }

  /**
   * Execute and persist one atomic transaction. Do not perform network or
   * provider calls inside the callback: the cross-process lock is held until
   * the transaction has been committed and the database file replaced.
   */
  async transaction<T>(fn: (db: SQLiteConnection) => T | Promise<T>): Promise<T> {
    return this.withLock(async () => {
      const db = await this.load()
      try {
        db.run('BEGIN IMMEDIATE')
        try {
          const result = await fn(db)
          db.run('COMMIT')
          await this.persist(db.export())
          return result
        } catch (error) {
          try { db.run('ROLLBACK') } catch {}
          throw error
        }
      } finally {
        db.close()
      }
    })
  }

  private applied(db: SQLiteConnection): AppliedMigration[] {
    const exists = rows(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").length > 0
    if (!exists) return []
    const records = rows(db, 'SELECT version, id, checksum, applied_at FROM schema_migrations ORDER BY version')
    return records.map((record) => ({
      version: Number(record['version']),
      id: String(record['id']),
      checksum: String(record['checksum']),
      appliedAt: String(record['applied_at']),
    }))
  }

  private validateApplied(applied: readonly AppliedMigration[]): void {
    for (let index = 0; index < applied.length; index++) {
      const record = applied[index]!
      const migration = this.migrations[index]
      if (!migration || record.version !== index + 1 || record.version !== migration.version ||
          record.id !== migration.id || record.checksum !== migration.checksum) {
        throw new Error(`sqlite: migration ledger mismatch at version ${record.version}; refusing to guess or rewrite schema`)
      }
    }
  }

  private planFrom(db: SQLiteConnection, targetVersion?: number): MigrationPlan {
    const applied = this.applied(db)
    this.validateApplied(applied)
    const currentVersion = applied.at(-1)?.version ?? 0
    const target = targetVersion ?? this.migrations.length
    if (!Number.isSafeInteger(target) || target < 0 || target > this.migrations.length) {
      throw new RangeError(`sqlite: target migration version must be between 0 and ${this.migrations.length}`)
    }
    if (target < currentVersion) throw new Error('sqlite: downgrade plans are not supported')
    return {
      currentVersion,
      targetVersion: target,
      pending: this.migrations
        .filter((migration) => migration.version > currentVersion && migration.version <= target)
        .map(({ version, id, checksum: digest }) => ({ version, id, checksum: digest })),
    }
  }

  /** Inspect migration state without creating or changing the database file. */
  async plan(targetVersion?: number): Promise<MigrationPlan> {
    return this.read((db) => this.planFrom(db, targetVersion))
  }

  /** Apply exactly the pending plan, refusing a stale plan or checksum drift. */
  async apply(plan: MigrationPlan): Promise<readonly AppliedMigration[]> {
    return this.transaction((db) => {
      db.run(LEDGER_SQL)
      const current = this.planFrom(db, plan.targetVersion)
      if (!samePlan(plan, current)) throw new Error('sqlite: migration plan is stale; create a new plan before applying')
      const applied: AppliedMigration[] = []
      for (const pending of current.pending) {
        const migration = this.migrations[pending.version - 1]!
        db.exec(migration.sql)
        const appliedAt = new Date().toISOString()
        db.run(
          'INSERT INTO schema_migrations (version, id, checksum, applied_at) VALUES (?, ?, ?, ?)',
          [migration.version, migration.id, migration.checksum, appliedAt],
        )
        applied.push({ version: migration.version, id: migration.id, checksum: migration.checksum, appliedAt })
      }
      return applied
    })
  }

  /** Verify every applied migration against the immutable, ordered migration list. */
  async verify(): Promise<void> {
    await this.read((db) => this.validateApplied(this.applied(db)))
  }
}
