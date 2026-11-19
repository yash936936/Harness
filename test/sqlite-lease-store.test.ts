import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLiteLeaseStore } from '../src/bundles/app-core/budgets.js'

describe('SQLiteLeaseStore', () => {
  let dir: string
  let path: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'harness-lease-store-'))
    path = join(dir, 'state.sqlite')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('allows only one owner and increments the fencing token after expiry', async () => {
    let now = Date.parse('2026-11-20T12:00:00.000Z')
    const a = new SQLiteLeaseStore(path, { now: () => now })
    const b = new SQLiteLeaseStore(path, { now: () => now })
    const request = (ownerId: string, idempotencyKey: string) => ({
      projectId: 'project-a', resourceType: 'workspace' as const, resourceId: 'task-1',
      ownerId, idempotencyKey, ttlMs: 5_000,
    })
    const first = await a.acquire(request('worker-a', 'acquire-a'))
    expect(first.acquired).toBe(true)
    const blocked = await b.acquire(request('worker-b', 'acquire-b'))
    expect(blocked).toEqual({ acquired: false, reason: 'owned' })
    if (!first.acquired) throw new Error('expected lease')
    now += 5_001
    const second = await b.acquire(request('worker-b', 'acquire-c'))
    expect(second.acquired).toBe(true)
    if (!second.acquired) throw new Error('expected replacement lease')
    expect(second.lease.fencingToken).toBeGreaterThan(first.lease.fencingToken)
    await expect(a.renew(first.lease.leaseId, 'worker-a', first.lease.fencingToken, 5_000)).rejects.toThrow(/stale or expired/)
    expect(await a.isCurrent(first.lease.leaseId, 'worker-a', first.lease.fencingToken)).toBe(false)
  })

  it('requires matching owner and fencing token to release or renew', async () => {
    const now = Date.parse('2026-11-20T12:00:00.000Z')
    const store = new SQLiteLeaseStore(path, { now: () => now })
    const result = await store.acquire({
      projectId: 'project-a', resourceType: 'index', resourceId: 'repo-index',
      ownerId: 'worker-a', idempotencyKey: 'acquire', ttlMs: 10_000,
    })
    expect(result.acquired).toBe(true)
    if (!result.acquired) throw new Error('expected lease')
    await expect(store.renew(result.lease.leaseId, 'worker-b', result.lease.fencingToken, 5_000)).rejects.toThrow(/stale or expired/)
    await store.release(result.lease.leaseId, 'worker-b', result.lease.fencingToken)
    expect(await store.isCurrent(result.lease.leaseId, 'worker-a', result.lease.fencingToken)).toBe(true)
    await store.release(result.lease.leaseId, 'worker-a', result.lease.fencingToken)
    expect(await store.isCurrent(result.lease.leaseId, 'worker-a', result.lease.fencingToken)).toBe(false)
  })

  it('replays idempotent acquisition and rejects a changed payload', async () => {
    const store = new SQLiteLeaseStore(path, { now: () => Date.parse('2026-11-20T12:00:00.000Z') })
    const request = {
      projectId: 'project-a', resourceType: 'job' as const, resourceId: 'job-1',
      ownerId: 'worker-a', idempotencyKey: 'same-key', ttlMs: 10_000,
    }
    const first = await store.acquire(request)
    expect(await store.acquire(request)).toEqual(first)
    expect(await store.acquire({ ...request, ownerId: 'worker-b' })).toEqual({ acquired: false, reason: 'idempotency-conflict' })
  })
})
