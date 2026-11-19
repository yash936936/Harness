import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLiteRateLimitStore } from '../src/bundles/app-core/budgets.js'

describe('SQLiteRateLimitStore', () => {
  let dir: string
  let path: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'harness-rate-store-'))
    path = join(dir, 'state.sqlite')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('atomically enforces a shared sliding-window limit across store instances', async () => {
    const now = Date.parse('2026-11-20T12:00:00.000Z')
    const a = new SQLiteRateLimitStore(path, { now: () => now })
    const b = new SQLiteRateLimitStore(path, { now: () => now })
    const request = (idempotencyKey: string) => ({
      projectId: 'project-a',
      principalId: 'provider-account',
      bucket: 'completion',
      idempotencyKey,
      limit: 1,
      windowMs: 60_000,
      maxConcurrent: 5,
      permitTtlMs: 30_000,
    })
    const results = await Promise.all([a.acquire(request('call-a')), b.acquire(request('call-b'))])
    expect(results.filter((result) => result.accepted)).toHaveLength(1)
    expect(results.filter((result) => !result.accepted)).toMatchObject([{ accepted: false, reason: 'rate-limited' }])
  })

  it('enforces concurrency independently of the sliding-window limit and releases permits', async () => {
    const now = Date.parse('2026-11-20T12:00:00.000Z')
    const store = new SQLiteRateLimitStore(path, { now: () => now })
    const request = (idempotencyKey: string) => ({
      projectId: 'project-a',
      principalId: 'provider-account',
      bucket: 'completion',
      idempotencyKey,
      limit: 10,
      windowMs: 60_000,
      maxConcurrent: 1,
      permitTtlMs: 30_000,
    })
    const first = await store.acquire(request('first'))
    expect(first.accepted).toBe(true)
    const blocked = await store.acquire(request('second'))
    expect(blocked).toMatchObject({ accepted: false, reason: 'concurrency-limit' })
    if (!first.accepted) throw new Error('expected first permit')
    await store.release(first.permit.permitId)
    const next = await store.acquire(request('third'))
    expect(next.accepted).toBe(true)
  })

  it('returns the original decision for an identical idempotency key and rejects changed payloads', async () => {
    const now = Date.parse('2026-11-20T12:00:00.000Z')
    const store = new SQLiteRateLimitStore(path, { now: () => now })
    const request = {
      projectId: 'project-a',
      principalId: 'provider-account',
      bucket: 'completion',
      idempotencyKey: 'same-key',
      limit: 3,
      windowMs: 60_000,
      maxConcurrent: 2,
      permitTtlMs: 30_000,
    }
    const first = await store.acquire(request)
    const replay = await store.acquire(request)
    expect(replay).toEqual(first)
    const conflict = await store.acquire({ ...request, limit: 4 })
    expect(conflict).toEqual({ accepted: false, reason: 'idempotency-conflict' })
  })

  it('reclaims expired permits and rate events using the injected clock', async () => {
    let now = Date.parse('2026-11-20T12:00:00.000Z')
    const store = new SQLiteRateLimitStore(path, { now: () => now })
    const request = (idempotencyKey: string) => ({
      projectId: 'project-a',
      principalId: 'provider-account',
      bucket: 'completion',
      idempotencyKey,
      limit: 1,
      windowMs: 60_000,
      maxConcurrent: 1,
      permitTtlMs: 5_000,
    })
    const first = await store.acquire(request('first'))
    expect(first.accepted).toBe(true)
    now += 61_000
    const next = await store.acquire(request('next'))
    expect(next.accepted).toBe(true)
  })

  it('rejects policy drift for an established project, principal, and bucket', async () => {
    const store = new SQLiteRateLimitStore(path)
    const base = {
      projectId: 'project-a',
      principalId: 'provider-account',
      bucket: 'completion',
      limit: 5,
      windowMs: 60_000,
      maxConcurrent: 2,
      permitTtlMs: 30_000,
    }
    const first = await store.acquire({ ...base, idempotencyKey: 'policy:first' })
    expect(first.accepted).toBe(true)
    await expect(store.acquire({ ...base, idempotencyKey: 'policy:changed', limit: 50 }))
      .rejects.toThrow(/policy changed/)
    await expect(store.acquire({ ...base, idempotencyKey: 'policy:changed-window', windowMs: 120_000 }))
      .rejects.toThrow(/policy changed/)
  })
})
