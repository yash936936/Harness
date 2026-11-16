import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SQLiteBudgetReservationStore } from '../src/bundles/app-core/budgets.js'
import type { BudgetReservationRequest } from '../src/architecture/contracts.js'

const dirs: string[] = []
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-budget-sqlite-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function request(overrides: Partial<BudgetReservationRequest> = {}): BudgetReservationRequest {
  return {
    projectId: 'project-test',
    subjectId: 'day:2026-11-16',
    metric: 'requests',
    amount: 1,
    hardLimit: 2,
    idempotencyKey: 'request:one',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ...overrides,
  }
}

function runWorker(path: string, key: string, expiresAt: string): Promise<unknown> {
  const workerPath = join(__dirname, 'fixtures', 'sqlite-budget-worker.ts')
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', workerPath, path, key, expiresAt], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code !== 0) return reject(new Error(`budget worker exited ${code}: ${stderr.slice(0, 500)}`))
      try { resolve(JSON.parse(stdout)) } catch { reject(new Error(`budget worker returned invalid JSON: ${stdout.slice(0, 300)}`)) }
    })
  })
}

describe('SQLite budget reservation store', () => {
  it('returns the original decision for an identical idempotency key and rejects a changed payload', async () => {
    const store = new SQLiteBudgetReservationStore(join(temp(), 'state.sqlite'))
    const input = request()
    const first = await store.reserve(input)
    const replay = await store.reserve(input)
    expect(first.accepted).toBe(true)
    expect(replay).toEqual(first)
    const conflict = await store.reserve({ ...input, amount: 2 })
    expect(conflict).toEqual({ accepted: false, reason: 'idempotency-conflict' })
  })

  it('remembers rejected decisions for the same idempotency key', async () => {
    const store = new SQLiteBudgetReservationStore(join(temp(), 'state.sqlite'))
    const accepted = await store.reserve(request({ hardLimit: 1 }))
    expect(accepted.accepted).toBe(true)
    const rejectedRequest = request({ idempotencyKey: 'request:two', hardLimit: 1 })
    const rejected = await store.reserve(rejectedRequest)
    expect(rejected).toEqual({ accepted: false, reason: 'limit-exceeded' })
    await expect(store.reserve(rejectedRequest)).resolves.toEqual(rejected)
  })

  it('settles exactly once and records actual usage even when it exceeds the reservation', async () => {
    const store = new SQLiteBudgetReservationStore(join(temp(), 'state.sqlite'))
    const result = await store.reserve(request({ hardLimit: 2 }))
    if (!result.accepted) throw new Error('test reservation was unexpectedly rejected')
    const settlement = { reservationId: result.reservation.reservationId, actualAmount: 3, idempotencyKey: 'settle:one' }
    const settled = await store.settle(settlement)
    expect(settled.state).toBe('settled')
    await expect(store.settle(settlement)).resolves.toEqual(settled)
    await expect(store.settle({ ...settlement, idempotencyKey: 'settle:two' })).rejects.toThrow(/already settled/)
    await expect(store.reserve(request({ idempotencyKey: 'request:after-settle', amount: 0, hardLimit: 2 })))
      .resolves.toEqual({ accepted: false, reason: 'limit-exceeded' })
  })

  it('does not allow a settlement idempotency key to be reused for another reservation', async () => {
    const store = new SQLiteBudgetReservationStore(join(temp(), 'state.sqlite'))
    const first = await store.reserve(request({ idempotencyKey: 'request:settle-a', hardLimit: 2 }))
    const second = await store.reserve(request({ idempotencyKey: 'request:settle-b', hardLimit: 2 }))
    if (!first.accepted || !second.accepted) throw new Error('test reservations were unexpectedly rejected')
    await store.settle({
      reservationId: first.reservation.reservationId,
      actualAmount: 1,
      idempotencyKey: 'settlement:shared',
    })
    await expect(store.settle({
      reservationId: second.reservation.reservationId,
      actualAmount: 1,
      idempotencyKey: 'settlement:shared',
    })).rejects.toThrow(/settlement idempotency key was reused/)
  })

  it('releases a live reservation idempotently and allows the capacity to be reserved again', async () => {
    const store = new SQLiteBudgetReservationStore(join(temp(), 'state.sqlite'))
    const result = await store.reserve(request({ hardLimit: 1 }))
    if (!result.accepted) throw new Error('test reservation was unexpectedly rejected')
    const released = await store.release(result.reservation.reservationId, 'test.cancelled')
    expect(released.state).toBe('released')
    await expect(store.release(result.reservation.reservationId, 'test.cancelled')).resolves.toEqual(released)
    const next = await store.reserve(request({ idempotencyKey: 'request:after-release', hardLimit: 1 }))
    expect(next.accepted).toBe(true)
  })

  it('rejects inconsistent hard limits for the same shared subject', async () => {
    const store = new SQLiteBudgetReservationStore(join(temp(), 'state.sqlite'))
    await store.reserve(request({ hardLimit: 2 }))
    await expect(store.reserve(request({ idempotencyKey: 'request:changed-limit', hardLimit: 3 })))
      .rejects.toThrow(/hard limit changed/)
  })

  it('expires abandoned reservations after their TTL', async () => {
    let now = Date.now()
    const store = new SQLiteBudgetReservationStore(join(temp(), 'state.sqlite'), {
      now: () => now,
      maxReservationTtlMs: 2_000,
    })
    const first = await store.reserve(request({
      hardLimit: 1,
      expiresAt: new Date(now + 1_000).toISOString(),
    }))
    expect(first.accepted).toBe(true)
    now += 1_100
    const second = await store.reserve(request({
      idempotencyKey: 'request:after-expiry',
      hardLimit: 1,
      expiresAt: new Date(now + 1_000).toISOString(),
    }))
    expect(second.accepted).toBe(true)
  })

  it('prevents independent processes from oversubscribing one shared hard limit', async () => {
    const path = join(temp(), 'state.sqlite')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => runWorker(path, `worker:${index}`, expiresAt)))
    const accepted = results.filter((result) => (result as { accepted?: boolean }).accepted === true)
    const rejected = results.filter((result) => (result as { accepted?: boolean }).accepted === false)
    expect(accepted).toHaveLength(1)
    expect(rejected).toHaveLength(5)
  }, 60_000)
})
