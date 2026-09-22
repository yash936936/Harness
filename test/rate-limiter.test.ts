import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LLMError, RateLimiter } from '../src/bundles/model-adapter/index.js'

/** Fake clock: sleeping advances time instantly, so window tests run in milliseconds. */
function clock(start = Date.UTC(2026, 8, 22, 12, 0, 0)) {
  let t = start
  const sleeps: number[] = []
  return {
    now: () => t,
    advance: (ms: number) => { t += ms },
    sleeps,
    sleep: async (ms: number) => { sleeps.push(ms); t += ms },
  }
}

describe('rate limiter: per-minute window', () => {
  it('lets perMinute requests through, then waits for the window to clear', async () => {
    const c = clock()
    const rl = new RateLimiter({ perMinute: 3, now: c.now, sleep: c.sleep })
    const start = c.now()
    for (let i = 0; i < 3; i++) await rl.run(async () => i)
    expect(c.sleeps).toEqual([])
    await rl.run(async () => 'fourth')
    expect(c.sleeps.length).toBe(1)
    expect(c.now() - start).toBeGreaterThanOrEqual(60_000)
  })

  it('never exceeds perMinute in any 60s window across many calls', async () => {
    const c = clock()
    const rl = new RateLimiter({ perMinute: 4, now: c.now, sleep: c.sleep })
    const at: number[] = []
    for (let i = 0; i < 20; i++) await rl.run(async () => { at.push(c.now()) })
    for (let i = 0; i < at.length; i++) {
      const inWindow = at.filter((x) => x >= at[i]! && x < at[i]! + 60_000).length
      expect(inWindow).toBeLessThanOrEqual(4)
    }
  })

  it('rejects nonsense config', () => {
    expect(() => new RateLimiter({ perMinute: 0 })).toThrow(LLMError)
    expect(() => new RateLimiter({ maxConcurrent: 0 })).toThrow(LLMError)
  })
})

describe('rate limiter: daily ceiling', () => {
  it('throws a non-retryable quota error once the ceiling is reached, without calling fn', async () => {
    const c = clock()
    const rl = new RateLimiter({ perMinute: 100, perDay: 2, now: c.now, sleep: c.sleep, provider: 'p' })
    await rl.run(async () => 1)
    await rl.run(async () => 2)
    let called = false
    const err = await rl.run(async () => { called = true }).catch((e) => e)
    expect(err).toBeInstanceOf(LLMError)
    expect(err.kind).toBe('quota')
    expect(err.retryable).toBe(false)
    expect(called).toBe(false)
    expect(rl.remainingToday()).toBe(0)
  })

  it('counts failed attempts too', async () => {
    const c = clock()
    const rl = new RateLimiter({ perMinute: 100, perDay: 3, now: c.now, sleep: c.sleep })
    await rl.run(async () => { throw new Error('boom') }).catch(() => {})
    await rl.run(async () => { throw new Error('boom') }).catch(() => {})
    expect(rl.remainingToday()).toBe(1)
  })

  it('resets on a new UTC day', async () => {
    const c = clock(Date.UTC(2026, 8, 22, 23, 59, 0))
    const rl = new RateLimiter({ perMinute: 100, perDay: 1, now: c.now, sleep: c.sleep })
    await rl.run(async () => 1)
    await expect(rl.run(async () => 2)).rejects.toMatchObject({ kind: 'quota' })
    c.advance(2 * 60_000)
    await expect(rl.run(async () => 3)).resolves.toBe(3)
  })

  it('reports no remaining count when there is no local ceiling', () => {
    expect(new RateLimiter().remainingToday()).toBeUndefined()
  })
})

describe('rate limiter: persistence', () => {
  it('a new limiter on the same statePath sees the earlier count', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-'))
    try {
      const path = join(dir, 'nested', 'state.json')
      const c = clock()
      const a = new RateLimiter({ perMinute: 100, perDay: 5, statePath: path, now: c.now, sleep: c.sleep })
      await a.run(async () => 1)
      await a.run(async () => 2)
      expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ count: 2 })
      const b = new RateLimiter({ perMinute: 100, perDay: 5, statePath: path, now: c.now, sleep: c.sleep })
      expect(b.remainingToday()).toBe(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ignores a corrupt or stale state file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-'))
    try {
      const path = join(dir, 'state.json')
      const { writeFileSync } = await import('node:fs')
      writeFileSync(path, 'not json')
      const c = clock()
      expect(new RateLimiter({ perDay: 5, statePath: path, now: c.now }).remainingToday()).toBe(5)
      writeFileSync(path, JSON.stringify({ day: '2001-01-01', count: 4 }))
      expect(new RateLimiter({ perDay: 5, statePath: path, now: c.now }).remainingToday()).toBe(5)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('rate limiter: concurrency and abort', () => {
  it('runs one request at a time by default', async () => {
    const rl = new RateLimiter({ perMinute: 100 })
    let active = 0
    let peak = 0
    const job = () => rl.run(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    })
    await Promise.all([job(), job(), job(), job()])
    expect(peak).toBe(1)
  })

  it('allows more in flight when maxConcurrent is raised', async () => {
    const rl = new RateLimiter({ perMinute: 100, maxConcurrent: 2 })
    let active = 0
    let peak = 0
    const job = () => rl.run(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    })
    await Promise.all([job(), job(), job(), job()])
    expect(peak).toBe(2)
  })

  it('an aborted waiter leaves the queue and does not hold a slot', async () => {
    const rl = new RateLimiter({ perMinute: 100 })
    let release!: () => void
    const blocker = rl.run(() => new Promise<void>((r) => { release = r }))
    const ac = new AbortController()
    const waiting = rl.run(async () => 'never', ac.signal)
    ac.abort(new Error('cancelled'))
    await expect(waiting).rejects.toThrow('cancelled')
    release()
    await blocker
    await expect(rl.run(async () => 'ok')).resolves.toBe('ok')
  })

  it('abort during a window wait rejects promptly', async () => {
    const rl = new RateLimiter({ perMinute: 1 })
    await rl.run(async () => 1)
    const ac = new AbortController()
    const p = rl.run(async () => 2, ac.signal)
    setTimeout(() => ac.abort(new Error('stop')), 10)
    await expect(p).rejects.toThrow('stop')
  })
})
