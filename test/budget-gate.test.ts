/** ARCH-03: budgets and rate limits are enforced at the model-call boundary, for every caller. */
import { Context } from 'cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { AgentLoop } from '../src/bundles/agent-loop/index.js'
import { ToolRegistry } from '../src/bundles/tool-registry/index.js'
import { LLMError, LLMService, MockProvider, estimateRequestTokens, type ModelAdapterConfig } from '../src/bundles/model-adapter/index.js'
import { BudgetExceededError, Budgets } from '../src/bundles/app-core/budgets.js'
import { bootProfileCoding, DEFAULT_CODING_BUDGETS } from '../src/profiles/profile-coding.js'

async function boot(cfg: ModelAdapterConfig, provider = new MockProvider(() => ({ text: 'ok', usage: { inputTokens: 10, outputTokens: 5 } }))) {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(EgressPolicy, { projectId: 'p' })
  await ctx.plugin(LLMService, cfg)
  ctx.llm.register('mock', provider, { default: true })
  return { ctx, provider }
}
const req = (extra: object = {}) => ({ sessionId: 's', messages: [{ role: 'user' as const, content: 'hello' }], maxTokens: 100, ...extra })
const types = async (ctx: Context) => (await ctx.log.read('s')).map((e) => e.type)

const tempDirs: string[] = []
function tempDir(): string {
  const path = mkdtempSync(join(tmpdir(), 'harness-shared-budget-'))
  tempDirs.push(path)
  return path
}
afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('Budgets.reserve / release / record', () => {
  const b = () => new Budgets({ requests: { session: { hard: 100 } } })

  it('held capacity counts against everyone else until released', () => {
    const x = b()
    const a = x.reserve('requests', 60)
    expect(() => x.reserve('requests', 60)).toThrow(BudgetExceededError) // would be 120 > 100, though nothing is SPENT yet
    x.release(a)
    expect(() => x.reserve('requests', 60)).not.toThrow()
  })
  it('release is idempotent and cannot free more than was held', () => {
    const x = b(); const a = x.reserve('requests', 60)
    x.release(a); x.release(a)
    x.reserve('requests', 100) // exactly the limit: fits
    expect(() => x.reserve('requests', 1)).toThrow(BudgetExceededError)
  })
  it('record books real usage even past the hard limit, and that blocks the next reserve', () => {
    const x = b()
    x.record('requests', 150)
    expect(x.status().requests.session.used).toBe(150)
    expect(() => x.reserve('requests', 1)).toThrow(BudgetExceededError)
  })
  it('spend() keeps its original refuse-before-recording behaviour', () => {
    const x = b()
    expect(() => x.spend('requests', 101)).toThrow(BudgetExceededError)
    expect(x.status().requests.session.used).toBe(0)
  })
})

describe('LLMService enforces the budget before the call', () => {
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid maxTokens %s before logging or calling a provider', async (maxTokens) => {
    const { ctx, provider } = await boot({})
    await expect(ctx.llm.complete(req({ maxTokens }))).rejects.toMatchObject({ kind: 'config' })
    expect(provider.calls).toHaveLength(0)
    expect(await types(ctx)).toEqual([])
  })

  it('a call whose estimate cannot fit is refused: provider never called, nothing logged as sent, budget.blocked recorded', async () => {
    const { ctx, provider } = await boot({ budgets: { tokens: { session: { hard: 500 } } } })
    const err: any = await ctx.llm.complete(req({ messages: [{ role: 'user', content: 'x'.repeat(3000) }] })).catch((e) => e)
    expect(err).toBeInstanceOf(LLMError)
    expect(err.kind).toBe('budget')
    expect(err.retryable).toBe(false)
    expect(provider.calls).toHaveLength(0)
    expect(await types(ctx)).toEqual(['budget.blocked'])
  })

  it('an unbounded call (no maxTokens) reserves the default output allowance, so it cannot sneak under a small limit', async () => {
    const { ctx, provider } = await boot({ budgets: { tokens: { session: { hard: 1000 } } } })
    const r = await ctx.llm.complete({ sessionId: 's', messages: [{ role: 'user', content: 'hi' }] }).catch((e) => e)
    expect(r).toBeInstanceOf(LLMError) // 1024 default output > 1000
    expect(provider.calls).toHaveLength(0)
  })

  it('passes the reserved default output allowance to the provider when maxTokens is omitted', async () => {
    const { ctx, provider } = await boot({ budgets: { tokens: { session: { hard: 10_000 } } } })
    await ctx.llm.complete({ sessionId: 's', messages: [{ role: 'user', content: 'hello' }] })
    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0]!.maxTokens).toBe(1024)
  })

  it('reservation is trued up to the provider-reported usage, freeing the unused part', async () => {
    const { ctx } = await boot({ budgets: { tokens: { session: { hard: 1000 } } } })
    // each call reserves ~140 (100 output + prompt estimate) but really uses 15; 20 calls would be ~2800 if estimates were kept
    for (let i = 0; i < 20; i++) await ctx.llm.complete(req())
    expect(ctx.llm.budget!.status().tokens.session.used).toBe(20 * 15)
    expect(ctx.llm.budget!.status().requests.session.used).toBe(20)
  })

  it('actual usage above the estimate is booked in full and blocks the next call', async () => {
    const { ctx } = await boot({ budgets: { tokens: { session: { hard: 1000 } } } }, new MockProvider(() => ({ text: 'big', usage: { inputTokens: 900, outputTokens: 900 } })))
    await ctx.llm.complete(req({ maxTokens: 50 }))
    expect(ctx.llm.budget!.status().tokens.session.used).toBe(1800)
    await expect(ctx.llm.complete(req({ maxTokens: 50 }))).rejects.toMatchObject({ kind: 'budget' })
  })

  it('rejects combining shared reservations with legacy daily state files', async () => {
    await expect(boot({
      budgets: {
        statePath: join(tempDir(), 'legacy-budget.json'),
        requests: { session: { hard: 1 } },
      },
      sharedBudget: { databasePath: join(tempDir(), 'state.sqlite'), projectId: 'shared-project' },
    })).rejects.toMatchObject({ kind: 'config' })
  })

  it('fails closed when a shared session limit has no session identity', async () => {
    const { ctx, provider } = await boot({
      budgets: { requests: { session: { hard: 1 } } },
      sharedBudget: { databasePath: join(tempDir(), 'state.sqlite'), projectId: 'shared-project' },
    })
    await expect(ctx.llm.complete({ messages: [{ role: 'user', content: 'hello' }], maxTokens: 100 } as any))
      .rejects.toMatchObject({ kind: 'config' })
    expect(provider.calls).toHaveLength(0)
  })

  it('requires explicit taskId and shares task reservations across LLMService instances', async () => {
    const databasePath = join(tempDir(), 'task-state.sqlite')
    const config: ModelAdapterConfig = {
      budgets: { requests: { task: { hard: 1 } }, tokens: { task: { hard: 10_000 } } },
      sharedBudget: { databasePath, projectId: 'shared-task-project' },
    }
    const first = await boot(config)
    const second = await boot(config)
    await expect(first.ctx.llm.complete(req())).rejects.toMatchObject({ kind: 'config' })
    await first.ctx.llm.complete(req({ taskId: 'task-42' }))
    await expect(second.ctx.llm.complete(req({ taskId: 'task-42' }))).rejects.toMatchObject({ kind: 'budget' })
    await expect(second.ctx.llm.complete(req({ taskId: 'task-43' }))).resolves.toBeTruthy()
    const status = await second.ctx.llm.budget!.statusAsync('s', 'task-42')
    expect(status.requests.task.used).toBe(1)
  })

  it('AgentLoop carries its explicit taskId into shared task reservations', async () => {
    const { ctx } = await boot({
      budgets: { requests: { task: { hard: 1 } } },
      sharedBudget: { databasePath: join(tempDir(), 'agent-task.sqlite'), projectId: 'agent-task-project' },
    })
    await ctx.plugin(AgentLoop)
    await ctx.agentLoop.run({ sessionId: 'agent-session', taskId: 'agent-task-1', prompt: 'first run', tools: [] })
    await expect(ctx.agentLoop.run({ sessionId: 'agent-session', taskId: 'agent-task-1', prompt: 'second run', tools: [] }))
      .rejects.toMatchObject({ kind: 'budget' })
  })

  it('two LLMService instances share session reservations through SQLite', async () => {
    let started!: () => void
    let finish!: () => void
    const providerStarted = new Promise<void>((resolve) => { started = resolve })
    const providerGate = new Promise<void>((resolve) => { finish = resolve })
    const firstProvider = new MockProvider(() => ({ text: 'first', usage: { inputTokens: 10, outputTokens: 5 } }))
    const originalComplete = firstProvider.complete.bind(firstProvider)
    firstProvider.complete = async (request) => {
      started()
      await providerGate
      return originalComplete(request)
    }
    const secondProvider = new MockProvider(() => ({ text: 'second' }))
    const sharedBudget = { databasePath: join(tempDir(), 'state.sqlite'), projectId: 'shared-project' }
    const config: ModelAdapterConfig = {
      budgets: { requests: { session: { hard: 1 } }, tokens: { session: { hard: 10_000 } } },
      sharedBudget,
    }
    const first = await boot(config, firstProvider)
    const second = await boot(config, secondProvider)

    const firstCall = first.ctx.llm.complete(req({ sessionId: 'shared-session' }))
    await providerStarted
    try {
      const blocked = await second.ctx.llm.complete(req({ sessionId: 'shared-session' })).catch((error) => error)
      expect(blocked).toBeInstanceOf(LLMError)
      expect(blocked.kind).toBe('budget')
      expect(secondProvider.calls).toHaveLength(0)
    } finally {
      finish()
    }
    await firstCall
    const status = await second.ctx.llm.budget!.statusAsync('shared-session')
    expect(status.requests.session.used).toBe(1)
    expect(status.tokens.session.used).toBe(15)
    await expect(second.ctx.llm.complete(req({ sessionId: 'shared-session' }))).rejects.toMatchObject({ kind: 'budget' })
    expect(secondProvider.calls).toHaveLength(0)
  })

  it('CONCURRENT calls cannot jointly exceed a request limit: exactly the allowed number go through', async () => {
    const { ctx, provider } = await boot({ budgets: { requests: { session: { hard: 3 } } } }, new MockProvider(() => ({ text: 'ok' })))
    const results = await Promise.all(Array.from({ length: 10 }, () => ctx.llm.complete(req()).then(() => 'ok', (e) => e.kind)))
    expect(results.filter((r) => r === 'ok')).toHaveLength(3)
    expect(results.filter((r) => r === 'budget')).toHaveLength(7)
    expect(provider.calls).toHaveLength(3)
  })

  it('a failed provider call still counts as a request, charges no tokens, and releases its hold', async () => {
    const { ctx } = await boot({ budgets: { requests: { session: { hard: 5 } }, tokens: { session: { hard: 10_000 } } } }, new MockProvider(() => new Error('boom')))
    await expect(ctx.llm.complete(req())).rejects.toBeInstanceOf(LLMError)
    const s = ctx.llm.budget!.status()
    expect(s.requests.session.used).toBe(1)
    expect(s.tokens.session.used).toBe(0)
    // the hold is gone: a full-limit reservation still fits
    expect(() => ctx.llm.budget!.budgets.reserve('tokens', 10_000)).not.toThrow()
  })

  it('crossing a soft limit is logged once as budget.warning', async () => {
    const { ctx } = await boot({ budgets: { requests: { session: { soft: 2, hard: 10 } } } })
    for (let i = 0; i < 4; i++) await ctx.llm.complete(req())
    expect((await types(ctx)).filter((t) => t === 'budget.warning')).toHaveLength(1)
  })

  it('no budgets configured: nothing changes', async () => {
    const { ctx } = await boot({})
    expect(ctx.llm.budget).toBeUndefined()
    await expect(ctx.llm.complete(req())).resolves.toBeTruthy()
  })

  it('estimateRequestTokens rejects zero, negative, fractional and unsafe output caps', () => {
    for (const maxTokens of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => estimateRequestTokens({ messages: [], maxTokens })).toThrow(/maxTokens/)
    }
    expect(() => estimateRequestTokens({ messages: [] }, 0)).toThrow(/default output reserve/)
  })

  it('estimateRequestTokens covers prompt plus allowed output and is pessimistic for dense text', () => {
    expect(estimateRequestTokens({ messages: [{ role: 'user', content: 'a'.repeat(300) }], maxTokens: 50 })).toBeGreaterThanOrEqual(150)
  })
})


  it('does not charge or retain a budget reservation when cancellation occurs while waiting for a limiter slot', async () => {
    let started!: () => void
    let release!: () => void
    const firstStarted = new Promise<void>((resolve) => { started = resolve })
    const firstGate = new Promise<void>((resolve) => { release = resolve })
    const provider = new MockProvider()
    const complete = provider.complete.bind(provider)
    provider.complete = async (request) => {
      if (provider.calls.length === 0) {
        started()
        await firstGate
      }
      return complete(request)
    }
    const { ctx } = await boot({
      budgets: { requests: { session: { hard: 2 } }, tokens: { session: { hard: 10_000 } } },
      rateLimit: { maxConcurrent: 1 },
    }, provider)

    const first = ctx.llm.complete(req({ sessionId: 'first' }))
    await firstStarted
    const controller = new AbortController()
    const queued = ctx.llm.complete(req({ sessionId: 'queued' }), controller.signal).catch((error) => error)
    for (let i = 0; i < 100 && (await ctx.log.read('queued')).length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect((await ctx.log.read('queued')).some((event) => event.type === 'model.request')).toBe(true)
    controller.abort(new Error('cancelled while queued'))
    await expect(queued).resolves.toBeInstanceOf(LLMError)

    release()
    await first
    expect(ctx.llm.budget!.status().requests.session.used).toBe(1)
    await expect(ctx.llm.complete(req({ sessionId: 'third' }))).resolves.toBeTruthy()
    expect(ctx.llm.budget!.status().requests.session.used).toBe(2)
    expect(provider.calls).toHaveLength(2)
  })

  it('releases a reservation when the request log fails before provider dispatch', async () => {
    const { ctx, provider } = await boot({ budgets: { requests: { session: { hard: 1 } } } })
    const append = ctx.log.append.bind(ctx.log)
    ;(ctx.log as any).append = async (sessionId: string, type: string, data: unknown, actor?: string) => {
      if (type === 'model.request') throw new Error('log unavailable')
      return append(sessionId, type, data, actor)
    }
    await expect(ctx.llm.complete(req())).rejects.toThrow('log unavailable')
    expect(ctx.llm.budget!.status().requests.session.used).toBe(0)
    ;(ctx.log as any).append = append
    await expect(ctx.llm.complete(req())).resolves.toBeTruthy()
    expect(provider.calls).toHaveLength(1)
  })

describe('the agent loop and its provider chain', () => {
  it('a budget stop ends the chain instead of trying the next provider', async () => {
    const { ctx } = await boot({ budgets: { requests: { session: { hard: 1 } } } })
    const second = new MockProvider(() => ({ text: 'second' }))
    ctx.llm.register('second', second)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(AgentLoop, { maxSteps: 5 })
    await ctx.agentLoop.run({ sessionId: 's', prompt: 'one' }) // uses the single allowed request
    const err: any = await ctx.agentLoop.run({ sessionId: 's2', prompt: 'two', providers: ['mock', 'second'] } as any).catch((e) => e)
    expect(err).toBeInstanceOf(LLMError)
    expect(err.kind).toBe('budget')
    expect(second.calls).toHaveLength(0)
  })
})

describe('one shared rate limiter', () => {
  it('maxConcurrent applies across all callers', async () => {
    let live = 0, peak = 0
    const slow = new MockProvider(() => ({ text: 'ok' }))
    const orig = slow.complete.bind(slow)
    slow.complete = async (r) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 30)); live--; return orig(r) }
    const { ctx } = await boot({ rateLimit: { maxConcurrent: 2 } }, slow)
    await Promise.all(Array.from({ length: 8 }, () => ctx.llm.complete(req())))
    expect(peak).toBe(2)
  })
})

describe('LLMService shared SQLite rate-limit integration', () => {
  it('enforces one concurrency ceiling across separate LLMService instances', async () => {
    let active = 0
    let peak = 0
    const makeProvider = (text: string) => new MockProvider(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 40))
      active--
      return { text, usage: { inputTokens: 1, outputTokens: 1 } }
    })
    const databasePath = join(tempDir(), 'shared-rate.sqlite')
    const config: ModelAdapterConfig = {
      rateLimit: { perMinute: 10, maxConcurrent: 1 },
      sharedRateLimit: { databasePath, projectId: 'rate-project', principalId: 'provider-account', permitTtlMs: 30_000 },
    }
    const first = await boot(config, makeProvider('first'))
    const second = await boot(config, makeProvider('second'))
    const results = await Promise.all([first.ctx.llm.complete(req()), second.ctx.llm.complete(req())])
    expect(results.map((result) => result.text).sort()).toEqual(['first', 'second'])
    expect(peak).toBe(1)
  })

  it('rejects shared budget and rate-limit configurations that disagree on database or project', async () => {
    await expect(boot({
      budgets: { requests: { day: { hard: 10 } } },
      sharedBudget: { databasePath: join(tempDir(), 'budget.sqlite'), projectId: 'project-a' },
      rateLimit: { perMinute: 10 },
      sharedRateLimit: { databasePath: join(tempDir(), 'rate.sqlite'), projectId: 'project-a', principalId: 'account-a' },
    })).rejects.toMatchObject({ kind: 'config' })
  })
})

describe('profile-coding meters every run by default', () => {
  const base = { projectId: 'b', projectRoot: process.cwd(), sessionLog: { memory: true } } as any
  it('applies the default runaway guard when no budgets are given', async () => {
    const ctx = await bootProfileCoding(base)
    expect(ctx.llm.budget).toBeDefined()
    expect(ctx.llm.budget!.status().requests.session.hard).toBe(DEFAULT_CODING_BUDGETS.requests!.session!.hard)
  })
  it('explicit budgets win, and `budgets: {}` is the deliberate opt-out', async () => {
    const own = await bootProfileCoding({ ...base, modelAdapter: { budgets: { requests: { session: { hard: 7 } } } } })
    expect(own.llm.budget!.status().requests.session.hard).toBe(7)
    const none = await bootProfileCoding({ ...base, modelAdapter: { budgets: {} } })
    expect(none.llm.budget!.status().requests.session.hard).toBeUndefined()
  })
  it('accepts the eval option (it was missing from the allowed keys)', async () => {
    await expect(bootProfileCoding({ ...base, eval: { threshold: 0.8 } })).resolves.toBeTruthy()
  })

  it('automatically shares the project SQLite budget database across coding-profile instances', async () => {
    const root = tempDir()
    const config = {
      projectId: 'shared-profile',
      projectRoot: root,
      sessionLog: { memory: true },
      modelAdapter: {
        budgets: { requests: { session: { hard: 1 } }, tokens: { session: { hard: 10_000 } } },
      },
    } as any
    const first = await bootProfileCoding(config)
    const second = await bootProfileCoding(config)
    let started!: () => void
    let finish!: () => void
    const providerStarted = new Promise<void>((resolve) => { started = resolve })
    const providerGate = new Promise<void>((resolve) => { finish = resolve })
    const firstProvider = new MockProvider(() => ({ text: 'first', usage: { inputTokens: 10, outputTokens: 5 } }))
    const originalComplete = firstProvider.complete.bind(firstProvider)
    firstProvider.complete = async (request) => {
      started()
      await providerGate
      return originalComplete(request)
    }
    const secondProvider = new MockProvider(() => ({ text: 'second' }))
    first.llm.register('shared', firstProvider, { default: true })
    second.llm.register('shared', secondProvider, { default: true })

    const firstCall = first.llm.complete(req({ sessionId: 'profile-shared-session' }))
    await providerStarted
    try {
      const blocked = await second.llm.complete(req({ sessionId: 'profile-shared-session' })).catch((error) => error)
      expect(blocked).toBeInstanceOf(LLMError)
      expect(blocked.kind).toBe('budget')
      expect(secondProvider.calls).toHaveLength(0)
    } finally {
      finish()
    }
    await firstCall
  })
})
