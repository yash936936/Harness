import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { ToolRegistry, type ToolDefinition } from '../src/bundles/tool-registry/index.js'
import { LLMService, MockProvider } from '../src/bundles/model-adapter/index.js'
import { AgentLoop } from '../src/bundles/agent-loop/index.js'
import { Orchestrator, OrchestratorError, PlanError, extractJson, validatePlan, type OrchestratorConfig } from '../src/bundles/orchestrator/index.js'
import { planSchema } from '../src/bundles/orchestrator/plan.js'

const reply = (o: unknown) => ({ text: typeof o === 'string' ? o : JSON.stringify(o), stopReason: 'end_turn' as const })
const good = { subtasks: [{ id: 's1', goal: 'find the file', tools: ['search'], dependsOn: [] }, { id: 's2', goal: 'read it', tools: ['read'], dependsOn: ['s1'] }] }

async function boot(script: ConstructorParameters<typeof MockProvider>[0] = [], config: OrchestratorConfig = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(EgressPolicy, { projectId: 'test' })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LLMService, {})
  const mock = new MockProvider(script)
  ctx.llm.register('mock', mock, { default: true })
  await ctx.plugin(AgentLoop, {})
  const ran: string[] = []
  const t = (name: string, actionClass: ToolDefinition['actionClass'] = 'read-only'): ToolDefinition => ({
    name, description: `does ${name}`, inputSchema: { type: 'object' }, actionClass, execute: () => { ran.push(name); return 'ok' },
  })
  ctx.tools.register(t('search')); ctx.tools.register(t('read')); ctx.tools.register(t('edit', 'real-fs-write'))
  await ctx.plugin(Orchestrator, config)
  return { ctx, mock, ran }
}
const reg = new Set(['search', 'read', 'edit'])
const sub = (o: object) => ({ subtasks: [{ id: 's1', goal: 'g', ...o }] })

describe('planner: accepted plans', () => {
  it('returns a validated plan, defaults missing tools/dependsOn, and logs it after the model reply', async () => {
    const { ctx } = await boot([reply({ subtasks: [{ id: 'a', goal: ' do a ' }] })])
    const r = await ctx.orchestrator.plan({ sessionId: 's', task: 'T' })
    expect(r.attempts).toBe(1)
    expect(r.plan).toEqual({ task: 'T', subtasks: [{ id: 'a', goal: 'do a', tools: [], dependsOn: [] }] })
    const types = (await ctx.log.read('s')).map((e) => e.type)
    expect(types.indexOf('plan.created')).toBeGreaterThan(types.indexOf('model.response'))
    expect(types).not.toContain('tool.call')
    const logged = (await ctx.log.read('s')).find((e) => e.type === 'plan.created')!.data as any
    expect(logged.plan).toEqual(r.plan)
  })
  it('accepts one fenced block, and dedupes repeated tools/deps', async () => {
    const { ctx } = await boot([reply('```json\n' + JSON.stringify({ subtasks: [{ id: 'a', goal: 'x', tools: ['read', 'read'] }, { id: 'b', goal: 'y', dependsOn: ['a', 'a'] }] }) + '\n```')])
    const r = await ctx.orchestrator.plan({ sessionId: 's', task: 'T' })
    expect(r.plan.subtasks.map((s) => [s.tools, s.dependsOn])).toEqual([[['read'], []], [[], ['a']]])
  })
  it('the planner is shown only the offered tools, and no tool specs', async () => {
    const { ctx, mock } = await boot([reply(good)])
    await ctx.orchestrator.plan({ sessionId: 's', task: 'T', tools: ['search', 'read'] })
    const req = mock.calls[0]!
    expect(req.system).toContain('search: does search')
    expect(req.system).not.toContain('edit')
    expect(req.tools ?? []).toEqual([])
  })
})

describe('planner: rejection and repair', () => {
  it('feeds the exact errors back and accepts the repaired plan', async () => {
    const { ctx, mock } = await boot([reply(sub({ tools: ['run_typecheck'] })), reply(good)])
    const r = await ctx.orchestrator.plan({ sessionId: 's', task: 'T' })
    expect(r.attempts).toBe(2)
    const second = mock.calls[1]!.messages[0]!.content as string
    expect(second).toContain('unknown tool "run_typecheck"')
    expect(second).toContain('Previous reply')
  })
  it('after the repair budget: PlanError, plan.rejected logged, no plan.created, nothing executed', async () => {
    const { ctx, mock, ran } = await boot([reply('sure! here you go'), reply({ subtasks: [] })])
    const p = ctx.orchestrator.plan({ sessionId: 's', task: 'T' })
    await expect(p).rejects.toBeInstanceOf(PlanError)
    await p.catch((e) => expect(e.attempts).toBe(2))
    expect(mock.calls.length).toBe(2)
    const types = (await ctx.log.read('s')).map((e) => e.type)
    expect(types).toContain('plan.rejected')
    expect(types).not.toContain('plan.created')
    expect(ran).toEqual([])
  })
  it('maxRepairs 0 means exactly one attempt; a larger budget allows more', async () => {
    const a = await boot([reply('nope'), reply(good)])
    await expect(a.ctx.orchestrator.plan({ sessionId: 's', task: 'T', maxRepairs: 0 })).rejects.toBeInstanceOf(PlanError)
    expect(a.mock.calls.length).toBe(1)
    const b = await boot([reply('x'), reply('y'), reply(good)])
    expect((await b.ctx.orchestrator.plan({ sessionId: 's', task: 'T', maxRepairs: 2 })).attempts).toBe(3)
  })
  it('a planner that emits a tool call anyway runs nothing (registry refuses unoffered tools)', async () => {
    const call = { toolCalls: [{ id: 'c1', name: 'edit', input: {} }], content: [{ type: 'tool_use' as const, id: 'c1', name: 'edit', input: {} }] }
    const { ctx, ran } = await boot([call, reply(good)])
    await ctx.orchestrator.plan({ sessionId: 's', task: 'T' }).catch(() => {})
    expect(ran).toEqual([])
  })
  it('misuse is an OrchestratorError raised before any model call', async () => {
    const { ctx, mock } = await boot([reply(good)])
    await expect(ctx.orchestrator.plan({ sessionId: 's', task: '   ' })).rejects.toBeInstanceOf(OrchestratorError)
    await expect(ctx.orchestrator.plan({ sessionId: 's', task: 'T', tools: ['ghost'] })).rejects.toBeInstanceOf(OrchestratorError)
    expect(mock.calls.length).toBe(0)
  })
})

describe('validatePlan / extractJson', () => {
  const bad = (raw: unknown, re: RegExp, limits?: Parameters<typeof validatePlan>[3]) => {
    const r = validatePlan('T', raw, reg, limits)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.errors.join(' | ')).toMatch(re)
  }
  it('rejects bad shapes', () => {
    bad([], /top level must be an object/)
    bad({}, /"subtasks" must be an array/)
    bad({ subtasks: [] }, /at least one/)
    bad({ subtasks: [5] }, /must be an object/)
    bad({ subtasks: [{ goal: 'g' }] }, /"id" must be a string/)
    bad({ subtasks: [{ id: 'bad id', goal: 'g' }] }, /"id" must be a string/)
    bad(sub({ goal: '  ' }), /non-empty/)
    bad({ subtasks: [{ id: 's1', goal: 5 }] }, /non-empty/)
  })
  it('enforces limits', () => {
    bad({ subtasks: Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, goal: 'g' })) }, /too many subtasks \(9\)/)
    bad(sub({ goal: 'x'.repeat(401) }), /too long/)
    bad(sub({ tools: ['search', 'read', 'edit', 'search2'] }), /too many tools/)
    bad(sub({ tools: ['search', 'read'] }), /too many tools/, { maxSubtasks: 8, maxToolsPerSubtask: 1, maxGoalChars: 400, maxIdChars: 32 })
    bad(sub({ id: 'x'.repeat(40) }), /"id" must be/)
  })
  it('rejects duplicate ids, unknown tools, non-string tools, and any non-earlier dependency', () => {
    bad({ subtasks: [{ id: 'a', goal: 'g' }, { id: 'a', goal: 'g' }] }, /duplicate id "a"/)
    bad(sub({ tools: ['nope'] }), /unknown tool "nope"/)
    bad(sub({ tools: [1] }), /array of strings/)
    bad(sub({ dependsOn: ['s1'] }), /EARLIER/) // self
    bad({ subtasks: [{ id: 'a', goal: 'g', dependsOn: ['b'] }, { id: 'b', goal: 'g' }] }, /EARLIER/) // forward => no cycles possible
    bad(sub({ dependsOn: ['ghost'] }), /EARLIER/)
  })
  it('reports several errors at once, capped at 10', () => {
    const r = validatePlan('T', { subtasks: Array.from({ length: 8 }, () => ({ id: 'a', goal: '', tools: ['z', 'y'] })) }, reg)
    expect(!r.ok && r.errors.length).toBe(10)
  })
  it('extractJson is all-or-nothing', () => {
    expect(extractJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } })
    for (const t of ['Here: {"a":1}', '{"a":1} thanks', '{"a":1}\n{"b":2}', '[1]', '', '{bad}', '```json\n{"a":1}\n``` and more'])
      expect(extractJson(t).ok).toBe(false)
  })
})

describe('planner: structured output (D-072)', () => {
  const toolsEnum = (schema: any) => schema.properties.subtasks.items.properties.tools.items.enum
  it('asks the provider to constrain output to a schema whose tool enum is exactly the offered tools', async () => {
    const { ctx, mock } = await boot([reply(good)])
    await ctx.orchestrator.plan({ sessionId: 's', task: 'T', tools: ['search', 'read'] })
    const schema = mock.calls[0]!.jsonSchema as any
    expect(schema).toEqual(planSchema(['search', 'read']))
    expect(toolsEnum(schema)).toEqual(['search', 'read'])
    expect(schema.properties.subtasks.items.required).toEqual(['id', 'goal', 'tools', 'dependsOn'])
  })
  it('the repair attempt is constrained too', async () => {
    const { ctx, mock } = await boot([reply('nope'), reply(good)])
    await ctx.orchestrator.plan({ sessionId: 's', task: 'T' })
    expect(mock.calls.map((c) => !!c.jsonSchema)).toEqual([true, true])
  })
  it('can be turned off per call or in config, to measure the unconstrained model', async () => {
    const a = await boot([reply(good)])
    await a.ctx.orchestrator.plan({ sessionId: 's', task: 'T', structured: false })
    expect(a.mock.calls[0]!.jsonSchema).toBeUndefined()
    const b = await boot([reply(good)], { structured: false })
    await b.ctx.orchestrator.plan({ sessionId: 's', task: 'T' })
    expect(b.mock.calls[0]!.jsonSchema).toBeUndefined()
  })
  it('the schema is a request, not the authority: a provider that ignores it is still validated', async () => {
    const { ctx } = await boot([reply(sub({ tools: ['run_typecheck'] })), reply(sub({ tools: ['run_typecheck'] }))])
    await expect(ctx.orchestrator.plan({ sessionId: 's', task: 'T' })).rejects.toBeInstanceOf(PlanError)
  })
  it('with no tools offered the schema allows only an empty tools array', () => {
    expect((planSchema([]) as any).properties.subtasks.items.properties.tools).toEqual({ type: 'array', maxItems: 0 })
  })
})
