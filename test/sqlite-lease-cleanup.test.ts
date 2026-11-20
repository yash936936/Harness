import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SQLiteLeaseStore } from '../src/bundles/app-core/budgets.js'

describe('SQLite lease history cleanup', () => {
  const dirs: string[] = []
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

  it('prunes terminal lease history while preserving monotonic fencing tokens', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-lease-cleanup-'))
    dirs.push(dir)
    let now = Date.parse('2026-11-20T12:00:00.000Z')
    const store = new SQLiteLeaseStore(join(dir, 'state.sqlite'), { now: () => now, maxLeaseTtlMs: 1_000 })
    const request = (key: string) => ({
      projectId: 'project-a', resourceType: 'workspace' as const, resourceId: 'cleanup-task',
      ownerId: 'worker', idempotencyKey: key, ttlMs: 1_000,
    })
    const first = await store.acquire(request('cleanup:first'))
    expect(first.acquired).toBe(true)
    if (!first.acquired) throw new Error('expected first lease')
    now += 3_001
    const second = await store.acquire(request('cleanup:second'))
    expect(second.acquired).toBe(true)
    if (!second.acquired) throw new Error('expected replacement lease')
    expect(second.lease.fencingToken).toBe(first.lease.fencingToken + 1)
  })
})
