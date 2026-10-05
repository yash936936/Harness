/**
 * 4.3b (D-073): memory is scoped per sub-agent. Everything here uses scripted models, so it tests the ACCESS RULES,
 * not whether any real model uses its memory.
 */
import { Context } from 'cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { ToolRegistry } from '../src/bundles/tool-registry/index.js'
import { LLMService, MockProvider } from '../src/bundles/model-adapter/index.js'
import { AgentLoop } from '../src/bundles/agent-loop/index.js'
import { Memory, MemoryError, lessonId, normaliseLesson, type MemoryConfig } from '../src/bundles/memory/index.js'
import { SubagentScope } from '../src/bundles/subagent-scope/index.js'

const dirs: string[] = []
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'harness-scope-'))
  dirs.push(d)
  return d
}
const A = 'subagent:a'
const B = 'subagent:b'

async function boot(opts: { memory?: MemoryConfig | false } = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(EgressPolicy, { projectId: 'test' })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LLMService, {})
  const mock = new MockProvider(() => ({ text: 'ok', stopReason: 'end_turn' as const }))
  ctx.llm.register('mock', mock, { default: true })
  await ctx.plugin(AgentLoop, {})
  ctx.tools.register({ name: 'search', description: 'd', inputSchema: { type: 'object' }, actionClass: 'read-only', execute: () => 'ok' })
  if (opts.memory !== false) await ctx.plugin(Memory, opts.memory ?? {})
  await ctx.plugin(SubagentScope)
  /** The system prompt the model was actually shown on the most recent call. */
  const system = () => mock.calls[mock.calls.length - 1]!.system ?? ''
  return { ctx, mock, system }
}

describe('hot tier visibility', () => {
  it('a scoped rule is shown to its own agent only; a global rule to everyone with a global grant', async () => {
    const { ctx, system } = await boot()
    await ctx.memory.hot.add({ text: 'GLOBAL-RULE' })
    await ctx.memory.hot.add({ text: 'A-ONLY-RULE', scope: A })
    await ctx.memory.hot.add({ text: 'B-ONLY-RULE', scope: B })
    const a = await ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: ['search'] })
    const b = await ctx.subagents.spawn({ id: 'b', sessionId: 's', tools: ['search'] })
    await a.run('go')
    expect(system()).toContain('GLOBAL-RULE')
    expect(system()).toContain('A-ONLY-RULE')
    expect(system()).not.toContain('B-ONLY-RULE')
    await b.run('go')
    expect(system()).toContain('B-ONLY-RULE')
    expect(system()).not.toContain('A-ONLY-RULE')
  })
  it('the main agent (no sub-agent actor) sees global rules only, never a sub-agent\'s', async () => {
    const { ctx, system } = await boot()
    await ctx.memory.hot.add({ text: 'GLOBAL-RULE' })
    await ctx.memory.hot.add({ text: 'A-ONLY-RULE', scope: A })
    await ctx.agentLoop.run({ sessionId: 's', actor: 'main', prompt: 'x', tools: [] })
    expect(system()).toContain('GLOBAL-RULE')
    expect(system()).not.toContain('A-ONLY-RULE')
  })
  it('hot grant "none": the agent sees only its own scoped rules, not the global ones', async () => {
    const { ctx, system } = await boot()
    await ctx.memory.hot.add({ text: 'GLOBAL-RULE' })
    await ctx.memory.hot.add({ text: 'A-ONLY-RULE', scope: A })
    const a = await ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: ['search'], memory: { hot: 'none' } })
    await a.run('go')
    expect(system()).toContain('A-ONLY-RULE')
    expect(system()).not.toContain('GLOBAL-RULE')
  })
  it('a sub-agent actor with no live grant (never spawned, or closed) sees NOTHING, global rules included: fail closed', async () => {
    const { ctx, system } = await boot()
    await ctx.memory.hot.add({ text: 'GLOBAL-RULE' })
    await ctx.memory.hot.add({ text: 'A-ONLY-RULE', scope: A })
    await ctx.agentLoop.run({ sessionId: 's', actor: 'subagent:ghost', prompt: 'x', tools: [] })
    expect(system()).not.toContain('GLOBAL-RULE')
    const a = await ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: ['search'] })
    await a.run('go')
    expect(system()).toContain('A-ONLY-RULE')
    await a.close()
    await ctx.agentLoop.run({ sessionId: 's', actor: A, prompt: 'x', tools: [] })
    expect(system()).not.toContain('A-ONLY-RULE')
    expect(system()).not.toContain('GLOBAL-RULE')
  })
  it('the token cap is spent only on what the viewer can see: another agent\'s big rules cannot crowd mine out', async () => {
    const { ctx } = await boot({ memory: { hotTokenCap: 120 } })
    for (let i = 0; i < 6; i++) await ctx.memory.hot.add({ text: `B-RULE-${i} ` + 'x'.repeat(60), scope: B, priority: 9 })
    await ctx.memory.hot.add({ text: 'MINE', scope: A, priority: 0 })
    ctx.memory.access.grant(A)
    const r = await ctx.memory.hot.render(ctx.memory.hotView(A))
    expect(r.text).toContain('MINE')
    expect(r.dropped).toEqual([])
  })
  it('a scope must be a sub-agent actor', async () => {
    const { ctx } = await boot()
    await expect(ctx.memory.hot.add({ text: 't', scope: 'main' })).rejects.toBeInstanceOf(MemoryError)
    await expect(ctx.memory.hot.add({ text: 't', scope: '' })).rejects.toBeInstanceOf(MemoryError)
  })
  it('scope persists to disk, and an old hot.json without any scope field still loads as global', async () => {
    const dir = await tmp()
    const m1 = await boot({ memory: { path: dir } })
    await m1.ctx.memory.hot.add({ text: 'PERSISTED', scope: A, id: 'x' })
    expect(JSON.parse(await readFile(join(dir, 'hot.json'), 'utf8'))[0].scope).toBe(A)
    await writeFile(join(dir, 'hot.json'), JSON.stringify([{ id: 'old', text: 'OLD-GLOBAL', priority: 0, ts: '2026-01-01T00:00:00.000Z' }]))
    const m2 = await boot({ memory: { path: dir } })
    expect((await m2.ctx.memory.hot.render()).text).toContain('OLD-GLOBAL')
  })
})

describe('episodic isolation', () => {
  it('each agent\'s runs are recorded under its own id, and its view returns only its own episodes', async () => {
    const { ctx } = await boot()
    const a = await ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: ['search'] })
    const b = await ctx.subagents.spawn({ id: 'b', sessionId: 's', tools: ['search'] })
    await a.run('task-for-a')
    await b.run('task-for-b')
    expect((await a.memory!.episodes()).map((e) => [e.agentId, e.task])).toEqual([[A, 'task-for-a']])
    expect((await b.memory!.episodes()).map((e) => [e.agentId, e.task])).toEqual([[B, 'task-for-b']])
  })
  it('a caller-supplied agentId cannot widen the view', async () => {
    const { ctx } = await boot()
    const a = await ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: ['search'] })
    const b = await ctx.subagents.spawn({ id: 'b', sessionId: 's', tools: ['search'] })
    await b.run('secret-b-task')
    const sneaky = await a.memory!.episodes({ agentId: B } as any)
    expect(sneaky).toEqual([])
  })
  it('the view of a closed agent throws; a view of a never-spawned scoped actor throws', async () => {
    const { ctx } = await boot()
    const a = await ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: ['search'] })
    const view = a.memory!
    await a.close()
    await expect(view.episodes()).rejects.toBeInstanceOf(MemoryError)
    await expect(view.hot()).rejects.toBeInstanceOf(MemoryError)
    await expect(ctx.memory.view('subagent:ghost').episodes()).rejects.toBeInstanceOf(MemoryError)
  })
  it('the phases.md 4.3 test: write to A\'s scope, B cannot read it, A can', async () => {
    const { ctx } = await boot()
    await ctx.memory.hot.add({ text: 'ONLY-FOR-A', scope: A })
    const a = await ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: ['search'] })
    const b = await ctx.subagents.spawn({ id: 'b', sessionId: 's', tools: ['search'] })
    expect((await a.memory!.hot()).text).toContain('ONLY-FOR-A')
    expect((await b.memory!.hot()).text).not.toContain('ONLY-FOR-A')
  })
})

describe('compaction does not leak across scopes', () => {
  /** Episodes must point at real session events, so each one gets a one-event session first. */
  const record = async (ctx: Context, agent: string | undefined, n: number, lesson: string) => {
    for (let i = 0; i < n; i++) {
      const sessionId = `${(agent ?? 'main').replace(/[^A-Za-z0-9_-]/g, '_')}-${i}-${Math.random().toString(36).slice(2, 8)}`
      await ctx.log.append(sessionId, 'note', {}, agent ?? 'main')
      await ctx.memory.episodic.record({ sessionId, ...(agent ? { agentId: agent } : {}), task: 't', fromSeq: 1, toSeq: 1, outcome: 'done', result: 'r', lesson })
    }
  }
  it('a lesson repeated by ONE sub-agent is promoted into that agent\'s scope only', async () => {
    const { ctx } = await boot()
    await record(ctx, A, 3, 'Always run lint first.')
    const r = await ctx.memory.compact()
    expect(r.promoted).toHaveLength(1)
    expect(r.promoted[0]!.scope).toBe(A)
    const stored = await ctx.memory.hot.list()
    expect(stored.map((e) => [e.text, e.scope])).toEqual([['Always run lint first.', A]])
    ctx.memory.access.grant(A); ctx.memory.access.grant(B)
    expect((await ctx.memory.hot.render(ctx.memory.hotView(A))).text).toContain('lint first')
    expect((await ctx.memory.hot.render(ctx.memory.hotView(B))).text).toBe('')
    expect((await ctx.memory.hot.render()).text).toBe('')
  })
  it('the same lesson from three DIFFERENT agents, one each, is promoted nowhere (the cross-agent channel is closed)', async () => {
    const { ctx } = await boot()
    await record(ctx, A, 1, 'Poisoned instruction.')
    await record(ctx, B, 1, 'Poisoned instruction.')
    await record(ctx, 'subagent:c', 1, 'Poisoned instruction.')
    const r = await ctx.memory.compact()
    expect(r.promoted).toEqual([])
    expect(await ctx.memory.hot.list()).toEqual([])
  })
  it('lessons from non-sub-agent actors still promote globally, as before', async () => {
    const { ctx } = await boot()
    await record(ctx, 'main', 2, 'Use tabs.')
    await record(ctx, undefined, 1, 'Use tabs.') // 3 across two non-sub-agent actors: counted together, as before
    const r = await ctx.memory.compact()
    expect(r.promoted).toHaveLength(1)
    expect(r.promoted[0]!.scope).toBeUndefined()
    expect((await ctx.memory.hot.list())[0]!.scope).toBeUndefined()
  })
  it('a global rule and a scoped rule with the same words are different rules with different ids', async () => {
    expect(lessonId(normaliseLesson('Use tabs.'))).not.toBe(lessonId(normaliseLesson('Use tabs.'), A))
    expect(lessonId(normaliseLesson('Use tabs.'), A)).not.toBe(lessonId(normaliseLesson('Use tabs.'), B))
    expect(lessonId('x')).toBe(lessonId('x', undefined))
  })
  it('a scoped rule the owner deleted stays deleted (ledger is per scope), and does not block the same lesson in another scope', async () => {
    const { ctx } = await boot()
    await record(ctx, A, 3, 'Always run lint first.')
    await ctx.memory.compact()
    const id = (await ctx.memory.hot.list())[0]!.id
    await ctx.memory.hot.remove(id)
    expect((await ctx.memory.compact()).promoted).toEqual([])
    expect(await ctx.memory.hot.list()).toEqual([])
    await record(ctx, B, 3, 'Always run lint first.')
    const r = await ctx.memory.compact()
    expect(r.promoted.map((p) => p.scope)).toEqual([B])
  })
})

describe('subagent-scope and memory', () => {
  it('works without the memory bundle: no episodes, no view, no error', async () => {
    const { ctx } = await boot({ memory: false })
    const a = await ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: ['search'] })
    expect(a.memory).toBeUndefined()
    const r: any = await a.run('go')
    expect(r.stopReason).toBe('done')
    expect(r.episode).toBeUndefined()
  })
  it('spawn grants and close revokes; closing a parent revokes its children too', async () => {
    const { ctx } = await boot()
    await ctx.subagents.spawn({ id: 'p', sessionId: 's', tools: ['search'], memory: { hot: 'none' } })
    await ctx.subagents.spawn({ id: 'c', sessionId: 's', tools: ['search'], parent: 'p' })
    expect(ctx.memory.access.get('subagent:p')).toEqual({ hot: 'none' })
    expect(ctx.memory.access.get('subagent:c')).toEqual({ hot: 'global' })
    const p = (await ctx.subagents.spawn({ id: 'solo', sessionId: 's', tools: [] }))
    await p.close()
    expect(ctx.memory.access.get('subagent:solo')).toBeUndefined()
  })
  it('closing a parent revokes the child\'s memory grant', async () => {
    const { ctx } = await boot()
    const p = await ctx.subagents.spawn({ id: 'p', sessionId: 's', tools: ['search'] })
    await ctx.subagents.spawn({ id: 'c', sessionId: 's', tools: ['search'], parent: 'p' })
    await p.close()
    expect(ctx.memory.access.get('subagent:c')).toBeUndefined()
  })
  it('a run records an episode with the optional lesson, under the agent\'s own id', async () => {
    const { ctx } = await boot()
    const a = await ctx.subagents.spawn({ id: 'a', sessionId: 's', tools: ['search'] })
    const r = await a.run('go', { lesson: 'check the logs first' })
    expect(r.episode).toMatchObject({ agentId: A, lesson: 'check the logs first' })
  })
  it('MemoryAccess rejects non-sub-agent actors and bad grants', async () => {
    const { ctx } = await boot()
    expect(() => ctx.memory.access.grant('main')).toThrow(/not a sub-agent actor/)
    expect(() => ctx.memory.access.grant(A, { hot: 'maybe' as any })).toThrow(/invalid hot grant/)
  })
})
