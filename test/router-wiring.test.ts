/** ARCH-02: the router is consulted at exactly one real decision point, only when it owns the class (or is shadowing), and only narrows. */
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { LLMService, MockProvider } from '../src/bundles/model-adapter/index.js'
import { ToolRegistry } from '../src/bundles/tool-registry/index.js'
import { AgentLoop } from '../src/bundles/agent-loop/index.js'
import { Router, type RouterBackend } from '../src/bundles/router/index.js'
import { bootProfileCoding, ProfileError } from '../src/profiles/profile-coding.js'

const needle = (answer: string | null | 'throw'): RouterBackend & { calls: number } => {
  const b: any = { name: 'needle', requestCost: 0, calls: 0, async decide() { b.calls++; if (answer === 'throw') throw new Error('needle broke'); return answer } }
  return b
}
const worker = (answer: string | null): RouterBackend & { calls: number } => {
  const b: any = { name: 'worker', requestCost: 1, calls: 0, async decide() { b.calls++; return answer } }
  return b
}

async function boot(routerCfg: ConstructorParameters<typeof Router>[1] | undefined, order: 'router-first' | 'loop-first' = 'router-first') {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(EgressPolicy, { projectId: 'p' })
  await ctx.plugin(LLMService)
  const provider = new MockProvider(() => ({ text: 'done' }))
  ctx.llm.register('mock', provider, { default: true })
  await ctx.plugin(ToolRegistry)
  for (const [name, actionClass] of [['grep', 'read-only'], ['read_file', 'read-only'], ['list_dir', 'read-only'], ['edit_file', 'real-fs-write']] as const) {
    ctx.tools.register({ name, description: `${name} tool`, actionClass, inputSchema: { type: 'object' }, execute: async () => 'ok' } as any)
  }
  if (order === 'router-first') { await ctx.plugin(Router, routerCfg); await ctx.plugin(AgentLoop) }
  else { await ctx.plugin(AgentLoop); await ctx.plugin(Router, routerCfg) }
  return { ctx, provider }
}
const run = (ctx: Context) => ctx.agentLoop.run({ sessionId: 's', prompt: 'find where foo is defined' })
const offered = (p: MockProvider, i = 0) => ((p.calls[i] as any).tools as Array<{ name: string }>).map((t) => t.name).sort()
const events = async (ctx: Context, type: string) => (await ctx.log.read('s')).filter((e) => e.type === type)

describe('ARCH-02 router at the first tool decision', () => {
  it('an UNOWNED router makes no call at all: the model sees every tool and no worker request is spent', async () => {
    const n = needle('grep'), w = worker('grep')
    const { ctx, provider } = await boot({ needle: n, worker: w })
    await run(ctx)
    expect(n.calls + w.calls).toBe(0)
    expect(offered(provider)).toEqual(['edit_file', 'grep', 'list_dir', 'read_file'])
    expect(await events(ctx, 'router.applied')).toHaveLength(0)
  })

  it('an OWNING router narrows the READ-ONLY tools to its pick; the write tool is untouched, and it is logged', async () => {
    const n = needle('grep')
    const { ctx, provider } = await boot({ needle: n, owned: ['tool'] })
    await run(ctx)
    expect(offered(provider)).toEqual(['edit_file', 'grep']) // read_file and list_dir narrowed away; edit_file never was the router's to touch
    const [applied] = await events(ctx, 'router.applied')
    expect((applied!.data as any)).toMatchObject({ class: 'tool', choice: 'grep', source: 'needle' })
  })

  it('it only ever offers the router read-only tools, so a write tool can never be the pick', async () => {
    const seen: string[] = []
    const spy: RouterBackend = { name: 'needle', async decide(_c, req) { seen.push(...req.candidates.map((c) => c.id)); return 'edit_file' } }
    const { ctx, provider } = await boot({ needle: spy, owned: ['tool'] })
    await run(ctx)
    expect(seen.sort()).toEqual(['grep', 'list_dir', 'read_file'])
    expect(offered(provider)).toEqual(['edit_file', 'grep', 'list_dir', 'read_file']) // invented/disallowed answer is rejected: nothing narrowed
  })

  it.each([['abstains', null], ['throws', 'throw' as const]])('when the router %s, the model chooses exactly as without a router', async (_n, answer) => {
    const { ctx, provider } = await boot({ needle: needle(answer), owned: ['tool'] })
    await run(ctx)
    expect(offered(provider)).toEqual(['edit_file', 'grep', 'list_dir', 'read_file'])
  })

  it('only the FIRST model call is routed; later steps see every tool again', async () => {
    const { ctx, provider } = await boot({ needle: needle('grep'), owned: ['tool'] })
    const mock = provider as any
    let n = 0
    mock.script = () => (n++ === 0 ? { toolCalls: [{ id: 'c1', name: 'grep', input: {} }], stopReason: 'tool_use' } : { text: 'done' })
    await run(ctx)
    expect(offered(provider, 0)).toEqual(['edit_file', 'grep'])
    expect(offered(provider, 1)).toEqual(['edit_file', 'grep', 'list_dir', 'read_file'])
  })

  it('wires up in either boot order', async () => {
    const { ctx, provider } = await boot({ needle: needle('grep'), owned: ['tool'] }, 'loop-first')
    await run(ctx)
    expect(offered(provider)).toEqual(['edit_file', 'grep'])
  })

  it('with no read-only choice to make (fewer than two), the router is not consulted', async () => {
    const n = needle('grep')
    const ctx = new Context()
    await ctx.plugin(SessionLog, { memory: true }); await ctx.plugin(EgressPolicy, { projectId: 'p' }); await ctx.plugin(LLMService)
    ctx.llm.register('mock', new MockProvider(() => ({ text: 'done' })), { default: true })
    await ctx.plugin(ToolRegistry)
    ctx.tools.register({ name: 'grep', description: 'g', actionClass: 'read-only', inputSchema: { type: 'object' }, execute: async () => 'ok' } as any)
    await ctx.plugin(Router, { needle: n, owned: ['tool'] }); await ctx.plugin(AgentLoop)
    await run(ctx)
    expect(n.calls).toBe(0)
  })
})

describe('shadow mode: measure Needle against the worker without acting on it', () => {
  it('logs Needle\'s pick and whether the worker agreed, changes nothing, spends no worker request', async () => {
    const n = needle('read_file'), w = worker('grep')
    const { ctx, provider } = await boot({ needle: n, worker: w, shadowTool: true })
    ;(provider as any).script = (() => { let i = 0; return () => (i++ === 0 ? { toolCalls: [{ id: 'c1', name: 'read_file', input: {} }], stopReason: 'tool_use' } : { text: 'done' }) })()
    await run(ctx)
    expect(offered(provider, 0)).toEqual(['edit_file', 'grep', 'list_dir', 'read_file']) // nothing narrowed
    expect(w.calls).toBe(0) // the worker is never asked in shadow mode
    expect(n.calls).toBe(1)
    const [sh] = await events(ctx, 'router.shadow')
    expect(sh!.data).toMatchObject({ needle: 'read_file' })
    const [res] = await events(ctx, 'router.shadow.result')
    expect(res!.data).toMatchObject({ needle: 'read_file', worker: 'read_file', agreed: true })
  })
  it('records a disagreement', async () => {
    const { ctx, provider } = await boot({ needle: needle('grep'), shadowTool: true })
    ;(provider as any).script = (() => { let i = 0; return () => (i++ === 0 ? { toolCalls: [{ id: 'c1', name: 'list_dir', input: {} }], stopReason: 'tool_use' } : { text: 'done' }) })()
    await run(ctx)
    expect((await events(ctx, 'router.shadow.result'))[0]!.data).toMatchObject({ needle: 'grep', worker: 'list_dir', agreed: false })
  })
  it('a missing Needle shadows to null and never breaks the run', async () => {
    const { ctx } = await boot({ shadowTool: true })
    await expect(run(ctx)).resolves.toBeTruthy()
    expect((await events(ctx, 'router.shadow'))[0]!.data).toMatchObject({ needle: null })
  })
})

describe('profile-coding refuses to pretend', () => {
  const base = { projectId: 'b', projectRoot: process.cwd(), sessionLog: { memory: true } } as any
  it.each([['agent'], ['playbook']])('owning "%s" is refused: it has no decision point', async (cls) => {
    await expect(bootProfileCoding({ ...base, router: { owned: [cls] } })).rejects.toThrow(/no decision point/)
  })
  it('owning "tool" and shadowing are accepted', async () => {
    await expect(bootProfileCoding({ ...base, router: { owned: ['tool'], shadowTool: true } })).resolves.toBeTruthy()
  })
})
