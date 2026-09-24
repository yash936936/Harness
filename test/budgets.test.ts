import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BudgetExceededError, Budgets } from '../src/bundles/app-core/budgets.js'

function clock(start = Date.UTC(2026, 8, 24, 12, 0, 0)) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe('budgets: no limits configured', () => {
  it('never throws, tracks usage, reports no breaches', () => {
    const b = new Budgets()
    b.spend('requests', 5)
    b.spend('tokens', 1000)
    const s = b.status()
    expect(s.requests.task.used).toBe(5)
    expect(s.tokens.day.used).toBe(1000)
    expect(s.requests.task.hardBreached).toBe(false)
    expect(s.requests.task.softBreached).toBe(false)
    expect(b.requestsLeftToday()).toBeUndefined()
  })
})

describe('budgets: hard limits', () => {
  it('spend() throws BudgetExceededError and records nothing when a scope would go over hard', () => {
    const b = new Budgets({ requests: { task: { hard: 5 } } })
    b.spend('requests', 5) // exactly at the limit is fine
    expect(() => b.spend('requests', 1)).toThrow(BudgetExceededError)
    expect(b.status().requests.task.used).toBe(5) // the rejected spend recorded nothing
  })

  it('the thrown error names the specific scope that tripped, and carries a full status report', () => {
    const b = new Budgets({ requests: { session: { hard: 3 } } })
    try {
      b.spend('requests', 10)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExceededError)
      const be = e as BudgetExceededError
      expect(be.metric).toBe('requests')
      expect(be.scope).toBe('session')
      // full report: every scope/metric is present, not just the one that tripped
      expect(be.status.requests.task).toBeDefined()
      expect(be.status.requests.day).toBeDefined()
      expect(be.status.tokens.session).toBeDefined()
    }
  })

  it('checks task before session before day, and rejecting one scope blocks the whole spend atomically', () => {
    // task's hard limit is the one that will trip; session has a much looser limit that would allow it.
    const b = new Budgets({ requests: { task: { hard: 2 }, session: { hard: 100 } } })
    b.spend('requests', 2)
    expect(() => b.spend('requests', 1)).toThrow(BudgetExceededError)
    // session must NOT have been incremented by the rejected spend either - atomic across scopes.
    expect(b.status().requests.session.used).toBe(2)
  })

  it('rejects a negative spend amount', () => {
    const b = new Budgets()
    expect(() => b.spend('requests', -1)).toThrow(RangeError)
  })
})

describe('budgets: soft limits', () => {
  it('softBreached flips true once used reaches soft, without blocking further spend', () => {
    const b = new Budgets({ requests: { day: { soft: 3 } } })
    b.spend('requests', 2)
    expect(b.status().requests.day.softBreached).toBe(false)
    b.spend('requests', 1)
    expect(b.status().requests.day.softBreached).toBe(true)
    expect(() => b.spend('requests', 5)).not.toThrow()
  })

  it('newlySoftBreached reports the crossing only on the call that causes it, not on repeats', () => {
    const b = new Budgets({ requests: { day: { soft: 3 } } })
    const r1 = b.spend('requests', 2)
    expect(r1.newlySoftBreached).toEqual([])
    const r2 = b.spend('requests', 1) // 3, crosses the soft limit
    expect(r2.newlySoftBreached).toEqual([{ metric: 'requests', scope: 'day' }])
    const r3 = b.spend('requests', 1) // already over - not "newly" anything
    expect(r3.newlySoftBreached).toEqual([])
  })
})

describe('budgets: requestsLeftToday', () => {
  it('counts down from the day hard limit', () => {
    const b = new Budgets({ requests: { day: { hard: 10 } } })
    expect(b.requestsLeftToday()).toBe(10)
    b.spend('requests', 4)
    expect(b.requestsLeftToday()).toBe(6)
  })

  it('never goes negative even if somehow over (floors at 0)', () => {
    const b = new Budgets({ requests: { day: { hard: 5 } } })
    b.spend('requests', 5)
    expect(b.requestsLeftToday()).toBe(0)
  })
})

describe('budgets: task/session reset', () => {
  it('resetTask clears only task, leaving session and day intact', () => {
    const b = new Budgets()
    b.spend('requests', 3)
    b.resetTask()
    const s = b.status()
    expect(s.requests.task.used).toBe(0)
    expect(s.requests.session.used).toBe(3)
    expect(s.requests.day.used).toBe(3)
  })

  it('resetSession clears only session, leaving task and day intact', () => {
    const b = new Budgets()
    b.spend('requests', 3)
    b.resetSession()
    const s = b.status()
    expect(s.requests.session.used).toBe(0)
    expect(s.requests.task.used).toBe(3)
    expect(s.requests.day.used).toBe(3)
  })
})

describe('budgets: day rollover', () => {
  it('day resets automatically when the UTC calendar day changes; task/session are unaffected', () => {
    const c = clock()
    const b = new Budgets({ now: c.now })
    b.spend('requests', 4)
    c.advance(24 * 60 * 60 * 1000) // next UTC day
    const s = b.status()
    expect(s.requests.day.used).toBe(0)
    expect(s.requests.task.used).toBe(4) // task/session are caller-managed, not time-managed
  })
})

describe('budgets: persistence (day counter survives restart, mirrors RateLimiter D-023)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'budgets-test-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('a fresh Budgets instance on the same day reads the prior instance\'s day counter', () => {
    const statePath = join(dir, 'nested', 'budgets.json')
    const c = clock()
    const b1 = new Budgets({ statePath, now: c.now })
    b1.spend('requests', 7)

    const b2 = new Budgets({ statePath, now: c.now })
    expect(b2.status().requests.day.used).toBe(7)
  })

  it('a fresh instance on a NEW day ignores the stale file and starts at 0', () => {
    const statePath = join(dir, 'budgets.json')
    const c1 = clock()
    new Budgets({ statePath, now: c1.now }).spend('requests', 7)

    const c2 = clock(c1.now() + 24 * 60 * 60 * 1000)
    const b2 = new Budgets({ statePath, now: c2.now })
    expect(b2.status().requests.day.used).toBe(0)
  })

  it('a corrupt state file is treated as no prior state, not a crash', () => {
    const statePath = join(dir, 'budgets.json')
    mkdirSync(dir, { recursive: true })
    writeFileSync(statePath, '{not valid json')
    expect(() => new Budgets({ statePath })).not.toThrow()
  })
})
