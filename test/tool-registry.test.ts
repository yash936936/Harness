import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { ToolDeniedError, ToolRegistrationError, ToolRegistry, type ToolDefinition } from '../src/bundles/tool-registry/index.js'
import type { ToolSpec } from '../src/bundles/model-adapter/index.js'

async function boot(config = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(ToolRegistry, config)
  return ctx
}
const S = { sessionId: 's' }
const types = async (ctx: Context) => (await ctx.log.read('s')).map((e) => e.type)

const tool = (over: Partial<ToolDefinition> = {}): ToolDefinition => ({
  name: 'echo',
  description: 'echo the text',
  actionClass: 'read-only',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  execute: ({ text }: any) => text,
  ...over,
})

describe('bundle-tool-registry', () => {
  it('a separate plugin registers a tool with zero edits to the registry, and unregisters on dispose', async () => {
    const ctx = await boot()
    const fiber = ctx.plugin({
      name: 'tool-bundle-echo',
      inject: ['tools'],
      apply(c: Context) { c.effect(() => c.tools.register(tool())) },
    } as any)
    await fiber
    expect(ctx.tools.list().map((t) => t.name)).toEqual(['echo'])
    expect(await ctx.tools.call('echo', { text: 'hi' }, S)).toEqual({ ok: true, content: 'hi' })
    await fiber.dispose()
    expect(ctx.tools.list()).toEqual([])
    expect((await ctx.tools.call('echo', { text: 'hi' }, S)).errorKind).toBe('unknown_tool')
  })

  it('dispatches each call to the right tool (no cross-calling) and lists both', async () => {
    const ctx = await boot()
    const hits: string[] = []
    ctx.tools.register(tool({ name: 'a', execute: () => (hits.push('a'), 'A') }))
    ctx.tools.register(tool({ name: 'b', execute: () => (hits.push('b'), 'B') }))
    expect(ctx.tools.list().map((t) => t.name).sort()).toEqual(['a', 'b'])
    expect((await ctx.tools.call('b', { text: 'x' }, S)).content).toBe('B')
    expect((await ctx.tools.call('a', { text: 'x' }, S)).content).toBe('A')
    expect(hits).toEqual(['b', 'a'])
  })

  it('rejects a duplicate name and keeps the original (no silent overwrite)', async () => {
    const ctx = await boot()
    ctx.tools.register(tool({ execute: () => 'original' }))
    expect(() => ctx.tools.register(tool({ execute: () => 'impostor' }))).toThrow(ToolRegistrationError)
    expect(() => ctx.tools.register(tool({ execute: () => 'impostor' }))).toThrow(/already registered/)
    expect((await ctx.tools.call('echo', { text: 'x' }, S)).content).toBe('original')
    // a stale disposer from a rejected/other registration must not remove the live tool
    const off = ctx.tools.register(tool({ name: 'other' }))
    off(); off()
    expect(ctx.tools.has('echo')).toBe(true)
  })

  it('validates registration: name, description, actionClass, schema', async () => {
    const ctx = await boot()
    expect(() => ctx.tools.register(tool({ name: 'bad name!' }))).toThrow(/invalid tool name/)
    expect(() => ctx.tools.register(tool({ name: 'x'.repeat(65) }))).toThrow(/invalid tool name/)
    expect(() => ctx.tools.register(tool({ description: ' ' }))).toThrow(/description/)
    expect(() => ctx.tools.register(tool({ actionClass: undefined as any }))).toThrow(/actionClass/)
    expect(() => ctx.tools.register(tool({ inputSchema: { type: 'string' } }))).toThrow(/type "object"/)
    expect(() => ctx.tools.register(tool({ inputSchema: { type: 'object', properties: { a: { type: 'nonsense' } } } }))).toThrow(/invalid inputSchema/)
    expect(ctx.tools.list()).toEqual([])
  })

  it('list() output is directly usable as model-adapter ToolSpec[]', async () => {
    const ctx = await boot()
    ctx.tools.register(tool())
    const specs: ToolSpec[] = ctx.tools.list()
    expect(specs[0]).toMatchObject({ name: 'echo', description: 'echo the text' })
  })

  it('unknown tool / bad input / throwing tool come back as ok:false, never throw', async () => {
    const ctx = await boot()
    let ran = 0
    ctx.tools.register(tool({ name: 'boom', execute: () => { throw new Error('kaput') } }))
    ctx.tools.register(tool({ name: 'strict', execute: () => (ran++, 'ran') }))

    const unknown = await ctx.tools.call('nope', {}, S)
    expect(unknown).toMatchObject({ ok: false, errorKind: 'unknown_tool' })
    expect(unknown.content).toMatch(/Available tools: boom, strict/)

    for (const bad of [{}, { text: 5 }, { text: 'x', extra: 1 }, 'str', null]) {
      expect(await ctx.tools.call('strict', bad, S)).toMatchObject({ ok: false, errorKind: 'invalid_input' })
    }
    expect(ran).toBe(0)

    expect(await ctx.tools.call('boom', { text: 'x' }, S)).toMatchObject({ ok: false, errorKind: 'execution', content: 'Tool "boom" failed: kaput' })
  })

  it('handles non-string output and truncates oversized output', async () => {
    const ctx = await boot({ maxOutputChars: 10 })
    ctx.tools.register(tool({ name: 'obj', execute: () => ({ a: 1 }) }))
    ctx.tools.register(tool({ name: 'none', execute: () => undefined }))
    ctx.tools.register(tool({ name: 'big', execute: () => 'x'.repeat(100) }))
    expect((await ctx.tools.call('obj', { text: '' }, S)).content).toBe('{"a":1}')
    expect((await ctx.tools.call('none', { text: '' }, S)).content).toBe('')
    const big = (await ctx.tools.call('big', { text: '' }, S)).content
    expect(big.startsWith('x'.repeat(10))).toBe(true)
    expect(big).toMatch(/truncated: 90 more/)
  })

  it('logs tool.call BEFORE execution and tool.result after; the logged result equals what was returned', async () => {
    const ctx = await boot()
    let before: string[] = []
    ctx.tools.register(tool({ execute: async () => { before = await types(ctx); return 'done' } }))
    const res = await ctx.tools.call('echo', { text: 'x' }, { sessionId: 's', actor: 'agent-1' })
    expect(before).toEqual(['tool.call'])
    const log = await ctx.log.read('s')
    expect(log.map((e) => e.type)).toEqual(['tool.call', 'tool.result'])
    expect(log[0]).toMatchObject({ actor: 'agent-1', data: { name: 'echo', input: { text: 'x' } } })
    expect(log[1]!.data).toMatchObject({ name: 'echo', ...res })
  })

  it('fails closed on log failure: unlogged calls never run, unlogged results never return', async () => {
    const ctx = await boot()
    let ran = 0
    ctx.tools.register(tool({ execute: () => (ran++, 'x') }))
    const real = ctx.log.append.bind(ctx.log)

    ctx.log.append = async () => { throw new Error('disk full') }
    await expect(ctx.tools.call('echo', { text: 'x' }, S)).rejects.toThrow('disk full')
    expect(ran).toBe(0)

    ctx.log.append = async (...a: Parameters<typeof real>) => {
      if (a[1] === 'tool.result') throw new Error('disk full')
      return real(...a)
    }
    await expect(ctx.tools.call('echo', { text: 'x' }, S)).rejects.toThrow('disk full')
  })

  describe('tools/pre-execute hook (policy-gates attach here in Phase 5)', () => {
    it('a ToolDeniedError blocks execution; the denial is a logged result', async () => {
      const ctx = await boot()
      let ran = 0
      ctx.tools.register(tool({ actionClass: 'real-fs-write', execute: () => (ran++, 'x') }))
      ctx.on('tools/pre-execute', (ev) => {
        if (ev.tool.actionClass === 'real-fs-write') throw new ToolDeniedError('needs approval')
      })
      const res = await ctx.tools.call('echo', { text: 'x' }, S)
      expect(res).toMatchObject({ ok: false, errorKind: 'denied' })
      expect(res.content).toContain('needs approval')
      expect(ran).toBe(0)
      expect(await types(ctx)).toEqual(['tool.call', 'tool.result'])
    })

    it('a crashing hook also blocks (fail closed)', async () => {
      const ctx = await boot()
      let ran = 0
      ctx.tools.register(tool({ execute: () => (ran++, 'x') }))
      ctx.on('tools/pre-execute', () => { throw new TypeError('hook bug') })
      expect(await ctx.tools.call('echo', { text: 'x' }, S)).toMatchObject({ ok: false, errorKind: 'denied' })
      expect(ran).toBe(0)
    })

    it('hooks see the call but cannot alter the input that executes', async () => {
      const ctx = await boot()
      let executed: any
      ctx.tools.register(tool({ execute: (i: any) => (executed = i, 'ok') }))
      ctx.on('tools/pre-execute', (ev) => { try { (ev.input as any).text = 'HACKED' } catch { /* frozen */ } })
      const original = { text: 'safe' }
      await ctx.tools.call('echo', original, S)
      expect(executed).toEqual({ text: 'safe' })
      expect(original).toEqual({ text: 'safe' })
    })

    it('hooks do not fire for calls rejected earlier (unknown tool / invalid input)', async () => {
      const ctx = await boot()
      let fired = 0
      ctx.tools.register(tool())
      ctx.on('tools/pre-execute', () => { fired++ })
      await ctx.tools.call('nope', {}, S)
      await ctx.tools.call('echo', {}, S)
      expect(fired).toBe(0)
    })
  })

  describe('tools/post-execute hook', () => {
    it('can redact the result before it is returned and logged', async () => {
      const ctx = await boot()
      ctx.tools.register(tool({ execute: () => 'token=sk-SECRET' }))
      ctx.on('tools/post-execute', (ev) => { ev.result.content = ev.result.content.replace(/sk-\w+/, '[REDACTED]') })
      const res = await ctx.tools.call('echo', { text: 'x' }, S)
      expect(res.content).toBe('token=[REDACTED]')
      const logged = JSON.stringify(await ctx.log.read('s'))
      expect(logged).not.toContain('sk-SECRET')
    })

    it('a crashing post hook withholds the output instead of leaking it', async () => {
      const ctx = await boot()
      ctx.tools.register(tool({ execute: () => 'sensitive' }))
      ctx.on('tools/post-execute', () => { throw new Error('scanner down') })
      const res = await ctx.tools.call('echo', { text: 'x' }, S)
      expect(res).toMatchObject({ ok: false, errorKind: 'denied' })
      expect(res.content).not.toContain('sensitive')
      expect(JSON.stringify(await ctx.log.read('s'))).not.toContain('"sensitive"')
    })
  })
})
