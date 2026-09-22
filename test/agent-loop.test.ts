import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { ToolRegistry, type ToolDefinition } from '../src/bundles/tool-registry/index.js'
import { LLMError, LLMService, MockProvider } from '../src/bundles/model-adapter/index.js'
import { AgentLoop, AgentLoopError, type AgentLoopConfig } from '../src/bundles/agent-loop/index.js'

interface ProviderSpec {
  name: string
  /** Same shape MockProvider takes: an array of canned responses/errors, or a responder function. */
  script?: ConstructorParameters<typeof MockProvider>[0]
  default?: boolean
}

async function boot(config: AgentLoopConfig = {}, providers: ProviderSpec[] = [{ name: 'mock', script: [], default: true }]) {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LLMService, {})
  const mocks = new Map<string, MockProvider>()
  for (const p of providers) {
    const mp = new MockProvider(p.script ?? [])
    mocks.set(p.name, mp)
    ctx.llm.register(p.name, mp, p.default ? { default: true } : {})
  }
  await ctx.plugin(AgentLoop, config)
  return { ctx, mocks }
}

function tool(name: string, execute: ToolDefinition['execute'], actionClass: ToolDefinition['actionClass'] = 'read-only'): ToolDefinition {
  return { name, description: `test tool ${name}`, inputSchema: { type: 'object' }, actionClass, execute }
}

// A fake clock for retry-delay tests, matching rate-limiter.test.ts's pattern: sleeping
// advances time instantly and records what it was asked to wait, so tests run in milliseconds.
function fakeSleep() {
  const waits: number[] = []
  const sleep = async (ms: number, signal?: AbortSignal) => {
    if (signal?.aborted) throw signal.reason
    waits.push(ms)
  }
  return { sleep, waits }
}

describe('agent-loop: happy path and tool calls', () => {
  it('completes a 2-tool-call task in exactly 3 model steps', async () => {
    const { ctx, mocks } = await boot({}, [
      {
        name: 'mock',
        default: true,
        script: [
          { toolCalls: [{ id: 'c1', name: 'read', input: {} }], content: [{ type: 'tool_use', id: 'c1', name: 'read', input: {} }] },
          { toolCalls: [{ id: 'c2', name: 'echo', input: {} }], content: [{ type: 'tool_use', id: 'c2', name: 'echo', input: {} }] },
          { text: 'done', stopReason: 'end_turn' },
        ],
      },
    ])
    ctx.tools.register(tool('read', () => 'file contents'))
    ctx.tools.register(tool('echo', (i: any) => `echo:${JSON.stringify(i)}`))

    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: 'read then echo the file' })

    expect(res.stopReason).toBe('done')
    expect(res.steps).toBe(3)
    expect(res.finalText).toBe('done')
    expect(mocks.get('mock')!.calls.length).toBe(3)
    // Transcript: user prompt, assistant(tool_use), user(tool_result), assistant(tool_use), user(tool_result), assistant(text)
    expect(res.messages).toHaveLength(6)
    expect(res.messages[2]!.content).toMatchObject([{ type: 'tool_result', toolUseId: 'c1', content: 'file contents', isError: false }])
  })

  it('a tool that throws surfaces as an isError tool_result, and the loop still finishes', async () => {
    const { ctx } = await boot({}, [
      {
        name: 'mock',
        default: true,
        script: [
          { toolCalls: [{ id: 'c1', name: 'broken', input: {} }], content: [{ type: 'tool_use', id: 'c1', name: 'broken', input: {} }] },
          { text: 'recovered', stopReason: 'end_turn' },
        ],
      },
    ])
    ctx.tools.register(tool('broken', () => { throw new Error('kaboom') }))

    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: 'go' })
    expect(res.stopReason).toBe('done')
    const toolResult = (res.messages[2]!.content as any[])[0]
    expect(toolResult).toMatchObject({ type: 'tool_result', isError: true })
    expect(toolResult.content).toContain('kaboom')
  })

  it('an unregistered tool name in the task throws before any model call', async () => {
    const { ctx, mocks } = await boot()
    await expect(ctx.agentLoop.run({ sessionId: 's', prompt: 'x', tools: ['does-not-exist'] })).rejects.toBeInstanceOf(AgentLoopError)
    expect(mocks.get('mock')!.calls.length).toBe(0)
  })
})

describe('agent-loop: max_steps boundary', () => {
  it('a task that would loop forever is stopped at maxSteps, not left running', async () => {
    let n = 0
    const { ctx, mocks } = await boot({ maxSteps: 3 }, [
      {
        name: 'mock',
        default: true,
        script: () => {
          n++
          return { toolCalls: [{ id: `c${n}`, name: 'loop', input: {} }], content: [{ type: 'tool_use', id: `c${n}`, name: 'loop', input: {} }] }
        },
      },
    ])
    ctx.tools.register(tool('loop', () => 'again'))

    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: 'never stop' })
    expect(res.stopReason).toBe('max_steps')
    expect(res.steps).toBe(3)
    expect(res.finalText).toBe('')
    expect(mocks.get('mock')!.calls.length).toBe(3)
  })

  it('rejects maxSteps < 1 at construction', async () => {
    await expect(boot({ maxSteps: 0 })).rejects.toBeInstanceOf(AgentLoopError)
  })
})

describe('agent-loop: retry policy follows LLMError.kind (D-023)', () => {
  it('a quota error is not retried -- the provider is called exactly once, then the run rejects', async () => {
    const { sleep, waits } = fakeSleep()
    const { ctx, mocks } = await boot({ sleep }, [
      { name: 'mock', default: true, script: [new LLMError('quota', 'daily cap reached', 'mock')] },
    ])
    const err = await ctx.agentLoop.run({ sessionId: 's', prompt: 'go' }).catch((e) => e)
    expect(err).toBeInstanceOf(LLMError)
    expect(err.kind).toBe('quota')
    expect(mocks.get('mock')!.calls.length).toBe(1)
    expect(waits).toEqual([])
  })

  it('a rate_limit error is retried once, honoring retryAfterMs, then succeeds', async () => {
    const { sleep, waits } = fakeSleep()
    const { ctx, mocks } = await boot({ sleep }, [
      {
        name: 'mock',
        default: true,
        script: [new LLMError('rate_limit', 'slow down', 'mock', 429, { retryAfterMs: 750 }), { text: 'ok', stopReason: 'end_turn' }],
      },
    ])
    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: 'go' })
    expect(res.stopReason).toBe('done')
    expect(res.finalText).toBe('ok')
    expect(res.steps).toBe(1) // one successful step; the failed attempt isn't a "step"
    expect(res.retries).toBe(1)
    expect(mocks.get('mock')!.calls.length).toBe(2)
    expect(waits).toEqual([750])
  })

  it('exhausts maxAttempts on retryable errors, then rejects with the last one', async () => {
    const { sleep } = fakeSleep()
    const { ctx, mocks } = await boot({ sleep, retry: { maxAttempts: 2 } }, [
      {
        name: 'mock',
        default: true,
        script: [
          new LLMError('server', 'down 1', 'mock', 500),
          new LLMError('server', 'down 2', 'mock', 500),
          new LLMError('server', 'down 3', 'mock', 500),
        ],
      },
    ])
    const err = await ctx.agentLoop.run({ sessionId: 's', prompt: 'go' }).catch((e) => e)
    expect(err.message).toBe('down 3')
    expect(mocks.get('mock')!.calls.length).toBe(3) // 1 + maxAttempts(2)
  })

  it('falls back to the next provider without retrying the first on a non-retryable error', async () => {
    const { sleep } = fakeSleep()
    const { ctx, mocks } = await boot({ sleep, fallbackProviders: ['backup'] }, [
      { name: 'mock', default: true, script: [new LLMError('quota', 'primary exhausted', 'mock')] },
      { name: 'backup', script: [{ text: 'from backup', stopReason: 'end_turn' }] },
    ])
    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: 'go' })
    expect(res.finalText).toBe('from backup')
    expect(mocks.get('mock')!.calls.length).toBe(1)
    expect(mocks.get('backup')!.calls.length).toBe(1)
  })

  it('an already-aborted signal stops the run before any model call', async () => {
    const { ctx, mocks } = await boot()
    const ac = new AbortController()
    ac.abort(new Error('cancelled up front'))
    await expect(ctx.agentLoop.run({ sessionId: 's', prompt: 'go', signal: ac.signal })).rejects.toThrow('cancelled up front')
    expect(mocks.get('mock')!.calls.length).toBe(0)
  })
})

describe('agent-loop: reflection', () => {
  it('when on, asks the model to double-check once, then finishes on the second answer', async () => {
    const { ctx, mocks } = await boot({ reflection: true }, [
      {
        name: 'mock',
        default: true,
        script: [
          { text: 'first answer', stopReason: 'end_turn' },
          { text: 'confirmed answer', stopReason: 'end_turn' },
        ],
      },
    ])
    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: 'go' })
    expect(res.steps).toBe(2)
    expect(res.reflected).toBe(true)
    expect(res.finalText).toBe('confirmed answer')
    expect(mocks.get('mock')!.calls.length).toBe(2)
    const secondCallMessages = mocks.get('mock')!.calls[1]!.messages
    expect(secondCallMessages.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('Double-check') })
  })

  it('reflects at most once per run, even if the model keeps giving text-only answers', async () => {
    const { ctx, mocks } = await boot({ reflection: true, maxSteps: 5 }, [
      { name: 'mock', default: true, script: [{ text: 'a', stopReason: 'end_turn' }, { text: 'b', stopReason: 'end_turn' }] },
    ])
    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: 'go' })
    expect(res.steps).toBe(2)
    expect(res.stopReason).toBe('done')
    expect(mocks.get('mock')!.calls.length).toBe(2)
  })

  it('off by default: a text-only answer finishes immediately', async () => {
    const { ctx } = await boot({}, [{ name: 'mock', default: true, script: [{ text: 'done', stopReason: 'end_turn' }] }])
    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: 'go' })
    expect(res.steps).toBe(1)
    expect(res.reflected).toBe(false)
  })
})

describe('agent-loop: log completeness', () => {
  it('every model call and tool call in a run has a matching session-log entry', async () => {
    const { ctx } = await boot({}, [
      {
        name: 'mock',
        default: true,
        script: [
          { toolCalls: [{ id: 'c1', name: 'read', input: {} }], content: [{ type: 'tool_use', id: 'c1', name: 'read', input: {} }] },
          { text: 'done', stopReason: 'end_turn' },
        ],
      },
    ])
    ctx.tools.register(tool('read', () => 'ok'))

    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: 'go' })
    const log = await ctx.log.read('s')
    const byType = (t: string) => log.filter((e) => e.type === t)

    expect(byType('model.request')).toHaveLength(res.steps)
    expect(byType('model.response')).toHaveLength(res.steps)
    expect(byType('model.error')).toHaveLength(0)
    expect(byType('tool.call')).toHaveLength(1)
    expect(byType('tool.result')).toHaveLength(1)
    // Every tool.call is immediately followed by its tool.result (no orphans).
    const calls = log.filter((e) => e.type === 'tool.call' || e.type === 'tool.result')
    for (let i = 0; i < calls.length; i += 2) {
      expect(calls[i]!.type).toBe('tool.call')
      expect(calls[i + 1]?.type).toBe('tool.result')
      expect((calls[i]!.data as any).name).toBe((calls[i + 1]!.data as any).name)
    }
  })

  it('a failed model call still logs model.error, and the thrown error carries the same kind', async () => {
    const { sleep } = fakeSleep()
    const { ctx } = await boot({ sleep }, [{ name: 'mock', default: true, script: [new LLMError('auth', 'bad key', 'mock', 401)] }])
    const err = await ctx.agentLoop.run({ sessionId: 's', prompt: 'go' }).catch((e) => e)
    expect(err.kind).toBe('auth')
    const log = await ctx.log.read('s')
    expect(log.filter((e) => e.type === 'model.error')).toHaveLength(1)
    expect(log.filter((e) => e.type === 'model.response')).toHaveLength(0)
  })
})
