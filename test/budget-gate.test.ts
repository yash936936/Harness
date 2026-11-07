/** ARCH-03: budgets and rate limits are enforced at the model-call boundary, for every caller. */
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
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
})
