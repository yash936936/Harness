import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SQLiteDatabase, type SQLiteConnection, type SQLiteMigration } from '../src/util/sqlite.js'

const dirs: string[] = []
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-sqlite-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const migrations: SQLiteMigration[] = [{
  version: 1,
  id: 'counter-table',
  sql: 'CREATE TABLE counter (id INTEGER PRIMARY KEY, value INTEGER NOT NULL); INSERT INTO counter (id, value) VALUES (1, 0);',
}]

function counterValue(db: SQLiteConnection): number {
  const result = db.exec('SELECT value FROM counter WHERE id = 1')
  return Number(result[0]?.values[0]?.[0] ?? -1)
}

function runWorker(path: string, count: number): Promise<void> {
  const workerPath = join(__dirname, 'fixtures', 'sqlite-worker.ts')
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', workerPath, path, String(count)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`SQLite worker exited ${code}: ${stderr.slice(0, 500)}`))
    })
  })
}

describe('SQLite shared-state foundation', () => {
  it('plans migrations without creating directories or changing the database', async () => {
    const path = join(temp(), 'not-created', 'state.sqlite')
    const store = new SQLiteDatabase(path, migrations)
    await expect(store.plan()).resolves.toMatchObject({
      currentVersion: 0,
      targetVersion: 1,
      pending: [{ version: 1, id: 'counter-table' }],
    })
    expect(existsSync(join(path, '..'))).toBe(false)
    expect(existsSync(path)).toBe(false)
  })

  it('applies ordered migrations and verifies the recorded checksums', async () => {
    const path = join(temp(), 'state.sqlite')
    const store = new SQLiteDatabase(path, migrations)
    const plan = await store.plan()
    const applied = await store.apply(plan)
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ version: 1, id: 'counter-table' })
    await expect(store.verify()).resolves.toBeUndefined()
    await expect(store.plan()).resolves.toMatchObject({ currentVersion: 1, pending: [] })
    await expect(store.read(counterValue)).resolves.toBe(0)
  })

  it('refuses stale plans and changed migration checksums', async () => {
    const path = join(temp(), 'state.sqlite')
    const store = new SQLiteDatabase(path, migrations)
    const plan = await store.plan()
    await store.apply(plan)
    await expect(store.apply(plan)).rejects.toThrow(/stale/)
    const changed = new SQLiteDatabase(path, [{
      ...migrations[0]!,
      sql: migrations[0]!.sql + ' ',
    }])
    await expect(changed.verify()).rejects.toThrow(/ledger mismatch/)
  })

  it('rolls back callback failures and does not persist partial writes', async () => {
    const path = join(temp(), 'state.sqlite')
    const store = new SQLiteDatabase(path, migrations)
    await store.apply(await store.plan())
    await expect(store.transaction((db) => {
      db.run('UPDATE counter SET value = 99 WHERE id = 1')
      throw new Error('abort transaction')
    })).rejects.toThrow('abort transaction')
    await expect(store.read(counterValue)).resolves.toBe(0)
  })

  it('serializes independent processes and does not lose concurrent updates', async () => {
    const path = join(temp(), 'state.sqlite')
    const store = new SQLiteDatabase(path, migrations)
    await store.apply(await store.plan())
    await Promise.all(Array.from({ length: 4 }, () => runWorker(path, 20)))
    await expect(store.read(counterValue)).resolves.toBe(80)
  }, 60_000)

  it.skipIf(process.platform === 'win32')('rejects a symlinked database file', async () => {
    const dir = temp()
    const target = join(dir, 'target.sqlite')
    const path = join(dir, 'linked.sqlite')
    const targetStore = new SQLiteDatabase(target, migrations)
    await targetStore.apply(await targetStore.plan())
    symlinkSync(target, path)
    const linked = new SQLiteDatabase(path, migrations)
    await expect(linked.read(counterValue)).rejects.toThrow(/symlink|regular non-symlink/)
  })
})
