import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SQLiteRateLimitStore } from '../src/bundles/app-core/budgets.js'

describe('SQLite rate-limit policy', () => {
  const dirs: string[] = []
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

  it('rejects policy drift for an established project, principal, and bucket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-rate-policy-'))
    dirs.push(dir)
    const store = new SQLiteRateLimitStore(join(dir, 'state.sqlite'))
    const base = {
      projectId: 'project-a', principalId: 'provider-account', bucket: 'completion',
      limit: 5, windowMs: 60_000, maxConcurrent: 2, permitTtlMs: 30_000,
    }
    const first = await store.acquire({ ...base, idempotencyKey: 'policy:first' })
    expect(first.accepted).toBe(true)
    await expect(store.acquire({ ...base, idempotencyKey: 'policy:changed', limit: 50 })).rejects.toThrow(/policy changed/)
    await expect(store.acquire({ ...base, idempotencyKey: 'policy:changed-window', windowMs: 120_000 })).rejects.toThrow(/policy changed/)
    await expect(store.acquire({ ...base, idempotencyKey: 'policy:changed-concurrency', maxConcurrent: 20 })).rejects.toThrow(/policy changed/)
  })
})
