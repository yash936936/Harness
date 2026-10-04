import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { ToolRegistry, type ToolDefinition } from '../src/bundles/tool-registry/index.js'
import { LLMService, MockProvider } from '../src/bundles/model-adapter/index.js'
import { AgentLoop } from '../src/bundles/agent-loop/index.js'
import { SubagentScope, ScopeError } from '../src/bundles/subagent-scope/index.js'

const call = (id: string, name: string) => ({ toolCalls: [{ id, name, input: {} }], content: [{ type: 'tool_use' as const, id, name, input: {} }] })

async function boot(script: ConstructorParameters<typeof MockProvider>[0] = []) {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(EgressPolicy, { projectId: 'test' })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LLMService, {})
  ctx.llm.register('mock', new MockProvider(script), { default: true })
  await ctx.plugin(AgentLoop, {})
  const ran: string[] = []
  const t = (name: string, actionClass: ToolDefinition['actionClass'] = 'read-only'): ToolDefinition => ({
    name, description: `tool ${name}`, inputSchema: { type: 'object' }, actionClass, execute: () => { ran.push(name); return `${name}-ok` },
  })
  ctx.tools.register(t('search')); ctx.tools.register(t('read')); ctx.tools.register(t('edit', 'real-fs-write'))
  await ctx.plugin(SubagentScope)
  return { ctx, ran }
}

describe('registry: a call outside the offered tool list is refused (D-068)', () => {
  it('does not run a registered tool the model was not offered, and logs the refusal', async () => {
    const { ctx, ran } = await boot([call('c1', 'edit'), { text: 'done', stopReason: 'end_turn' }])
    const r = await ctx.agentLoop.run({ sessionId: 's', prompt: 'x', tools: ['search'] })
    expect(ran).toEqual([])
    expect(r.stopReason).toBe('done')
    const evs = await ctx.log.read('s')
    const res = evs.find((e) => e.type === 'tool.result')!.data as any
    expect(res.ok).toBe(false)
    expect(res.errorKind).toBe('denied')
    expect(res.content).toContain('Available tools: search')
    expect(res.content).not.toContain('read') // does not leak the rest of the registry
  })
  it('a hallucinated name that is not registered is unknown_tool, naming only the offered tools', async () => {
    const { ctx } = await boot([call('c1', 'run_typecheck'), { text: 'done', stopReason: 'end_turn' }])
    await ctx.agentLoop.run({ sessionId: 's', prompt: 'x', tools: ['search'] })
    const res = (await ctx.log.read('s')).find((e) => e.type === 'tool.result')!.data as any
    expect(res.errorKind).toBe('unknown_tool')
    expect(res.content).toBe('Tool "run_typecheck" is not available in this run. Available tools: search.')
  })
  it('an offered tool still runs', async () => {
    const { ctx, ran } = await boot([call('c1', 'search'), { text: 'done', stopReason: 'end_turn' }])
    await ctx.agentLoop.run({ sessionId: 's', prompt: 'x', tools: ['search'] })
    expect(ran).toEqual(['search'])
  })
})

describe('subagent-scope: spawn validation', () => {
  it('rejects bad ids, duplicates, and unregistered grants', async () => {
    const { ctx } = await boot()
    await expect(ctx.subagents.spawn({ id: 'a:b', sessionId: 's', tools: [] })).rejects.toBeInstanceOf(ScopeError)
    await ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: ['search'] })
    await expect(ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: [] })).rejects.toThrow(/already exists/)
    await expect(ctx.subagents.spawn({ id: 'b', sessionId: 's', tools: ['nope'] })).rejects.toThrow(/not registered/)
  })
  it('a child cannot widen its parent\'s grant; a closed or unknown parent is refused', async () => {
    const { ctx } = await boot()
    const p = await ctx.subagents.spawn({ id: 'p', sessionId: 's', tools: ['search'] })
    await expect(ctx.subagents.spawn({ id: 'c', sessionId: 's', tools: ['search', 'edit'], parent: 'p' })).rejects.toThrow(/cannot widen/)
    await expect(ctx.subagents.spawn({ id: 'c', sessionId: 's', tools: ['search'], parent: 'ghost' })).rejects.toThrow(/not a live/)
    const ok = await ctx.subagents.spawn({ id: 'c', sessionId: 's', tools: ['search'], parent: 'p' })
    expect(ok.parent).toBe('p')
    await p.close()
    await expect(ctx.subagents.spawn({ id: 'd', sessionId: 's', tools: ['search'], parent: 'p' })).rejects.toThrow(/not a live/)
  })
  it('spawn and close are session-log events', async () => {
    const { ctx } = await boot()
    const a = await ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: ['search', 'search'] })
    await a.close()
    const types = (await ctx.log.read('s')).map((e) => [e.type, (e.data as any).tools])
    expect(types).toEqual([['subagent.spawn', ['search']], ['subagent.close', undefined]])
  })
})

describe('subagent-scope: enforcement (security)', () => {
  it('two agents with different grants: each is blocked from the other\'s tool, through the real loop', async () => {
    const { ctx, ran } = await boot([
      call('c1', 'edit'), { text: 'A done', stopReason: 'end_turn' },   // reader tries to edit
      call('c2', 'search'), { text: 'B done', stopReason: 'end_turn' }, // editor tries to search
    ])
    const reader = await ctx.subagents.spawn({ id: 'reader', sessionId: 's', tools: ['search', 'read'] })
    const editor = await ctx.subagents.spawn({ id: 'editor', sessionId: 's', tools: ['edit'] })
    await reader.run('go')
    await editor.run('go')
    expect(ran).toEqual([])
    const results = (await ctx.log.read('s')).filter((e) => e.type === 'tool.result')
    expect(results.map((e) => [e.actor, (e.data as any).ok])).toEqual([['subagent:reader', false], ['subagent:editor', false]])
  })
  it('granted tools run, logged under the agent\'s own actor', async () => {
    const { ctx, ran } = await boot([call('c1', 'edit'), { text: 'ok', stopReason: 'end_turn' }])
    const editor = await ctx.subagents.spawn({ id: 'editor', sessionId: 's', tools: ['edit'] })
    await editor.run('go')
    expect(ran).toEqual(['edit'])
    expect((await ctx.log.read('s')).filter((e) => e.type === 'tool.call').every((e) => e.actor === 'subagent:editor')).toBe(true)
  })
  it('the hook holds even when the registry is called directly with no offered-tool list', async () => {
    const { ctx, ran } = await boot()
    await ctx.subagents.spawn({ id: 'reader', sessionId: 's', tools: ['search'] })
    const r = await ctx.tools.call('edit', {}, { sessionId: 's', actor: 'subagent:reader' })
    expect(r).toMatchObject({ ok: false, errorKind: 'denied' })
    expect(ran).toEqual([])
  })
  it('a forged or unknown subagent: actor is denied everything (fail closed)', async () => {
    const { ctx, ran } = await boot()
    const r = await ctx.tools.call('search', {}, { sessionId: 's', actor: 'subagent:ghost' })
    expect(r).toMatchObject({ ok: false, errorKind: 'denied' })
    expect(ran).toEqual([])
  })
  it('run cannot widen the grant', async () => {
    const { ctx } = await boot()
    const a = await ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: ['search'] })
    await expect(a.run('go', { tools: ['search', 'edit'] })).rejects.toThrow(/outside its grant/)
  })
  it('run may narrow the grant', async () => {
    const { ctx, ran } = await boot([call('c1', 'read'), { text: 'x', stopReason: 'end_turn' }])
    const a = await ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: ['search', 'read'] })
    await a.run('go', { tools: ['search'] })
    expect(ran).toEqual([]) // 'read' was in the grant but not in this run's narrowed list
  })
  it('a closed agent can neither run nor call tools, and closing a parent closes its children', async () => {
    const { ctx, ran } = await boot()
    const p = await ctx.subagents.spawn({ id: 'p', sessionId: 's', tools: ['search'] })
    const c = await ctx.subagents.spawn({ id: 'c', sessionId: 's', tools: ['search'], parent: 'p' })
    await p.close()
    expect(c.closed).toBe(true)
    await expect(c.run('go')).rejects.toThrow(/closed/)
    expect(await ctx.tools.call('search', {}, { sessionId: 's', actor: 'subagent:c' })).toMatchObject({ ok: false, errorKind: 'denied' })
    expect(ran).toEqual([])
    expect(ctx.subagents.list()).toEqual([])
  })
  it('a closed id cannot be re-spawned with a wider grant', async () => {
    const { ctx } = await boot()
    const a = await ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: ['search'] })
    await a.close()
    await expect(ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: ['edit'] })).rejects.toThrow(/already exists/)
  })
  it('agents without a subagent: actor are unaffected by scopes', async () => {
    const { ctx, ran } = await boot()
    await ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: ['search'] })
    expect(await ctx.tools.call('edit', {}, { sessionId: 's', actor: 'main' })).toMatchObject({ ok: true })
    expect(ran).toEqual(['edit'])
  })
})
