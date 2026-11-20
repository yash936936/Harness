import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateLegacyBudgetStateToSQLite, SQLiteBudgetReservationStore } from '../src/bundles/app-core/budgets.js'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harness-legacy-budget-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('legacy budget state migration', () => {
  it('imports same-day counters exactly once and preserves the original file', async () => {
    const dir = tempDir()
    const statePath = join(dir, 'budgets.json')
    const databasePath = join(dir, 'state.sqlite')
    const now = () => Date.parse('2026-11-20T12:00:00.000Z')
    const source = JSON.stringify({ day: '2026-11-20', requests: 7, tokens: 321 })
    writeFileSync(statePath, source)
    const options = { statePath, databasePath, projectId: 'legacy-project', requestHardLimit: 10, tokenHardLimit: 1000, now }
    await expect(migrateLegacyBudgetStateToSQLite(options)).resolves.toEqual({ imported: true, day: '2026-11-20' })
    await expect(migrateLegacyBudgetStateToSQLite(options)).resolves.toEqual({ imported: false, day: '2026-11-20' })
    expect(readFileSync(statePath, 'utf8')).toBe(source)
    const store = new SQLiteBudgetReservationStore(databasePath, { now })
    await expect(store.usage('legacy-project', 'day:2026-11-20', 'requests')).resolves.toMatchObject({ committed: 7, hardLimit: 10 })
    await expect(store.usage('legacy-project', 'day:2026-11-20', 'tokens')).resolves.toMatchObject({ committed: 321, hardLimit: 1000 })
  })

  it('does not import stale-day counters after UTC rollover', async () => {
    const dir = tempDir()
    const statePath = join(dir, 'budgets.json')
    writeFileSync(statePath, JSON.stringify({ day: '2026-11-19', requests: 99, tokens: 999 }))
    await expect(migrateLegacyBudgetStateToSQLite({
      statePath, databasePath: join(dir, 'state.sqlite'), projectId: 'legacy-project',
      now: () => Date.parse('2026-11-20T00:00:00.000Z'),
    })).resolves.toEqual({ imported: false, day: '2026-11-20' })
  })

  it('fails closed for malformed and future-dated legacy state', async () => {
    const dir = tempDir()
    const statePath = join(dir, 'budgets.json')
    const options = { statePath, databasePath: join(dir, 'state.sqlite'), projectId: 'legacy-project', now: () => Date.parse('2026-11-20T12:00:00.000Z') }
    writeFileSync(statePath, '{broken')
    await expect(migrateLegacyBudgetStateToSQLite(options)).rejects.toThrow(/not valid JSON/)
    writeFileSync(statePath, JSON.stringify({ day: '2026-11-21', requests: 1, tokens: 1 }))
    await expect(migrateLegacyBudgetStateToSQLite(options)).rejects.toThrow(/ahead of the system date/)
  })

  it('does not treat a missing legacy file as imported usage', async () => {
    const dir = tempDir()
    await expect(migrateLegacyBudgetStateToSQLite({
      statePath: join(dir, 'missing.json'), databasePath: join(dir, 'state.sqlite'), projectId: 'legacy-project',
      now: () => Date.parse('2026-11-20T12:00:00.000Z'),
    })).resolves.toEqual({ imported: false, day: '2026-11-20' })
  })
})
