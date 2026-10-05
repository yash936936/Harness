/**
 * 4.4: multi-agent integration test. A real task on a real (temp) workspace: find a bug, fix it, verify it, as three subtasks
 * across two distinctly scoped sub-agents (a read-only researcher/verifier and a write-only editor), planned by `plan()` and run by `execute()`.
 *
 * What is real: the planner call and schema, the executor, sub-agent scoping (tools AND memory), the tool registry, the session log, the memory bundle,
 * and the files on disk. What is scripted: the model, which is a deterministic function (it does a tiny real computation on the file text, and it
 * deliberately tries out-of-scope calls). So this proves the harness keeps agents inside their scopes and moves data between them correctly;
 * it does NOT show that a real model could do the task.
 *
 * The scope check is an independent AUDIT OF THE LOG (`auditScopes`), not a re-run of the enforcement code, and it is itself tested against a doctored log.
 */
import { Context } from 'cordis'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionLog, type SessionEvent } from '../src/bundles/session-log/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { ToolRegistry } from '../src/bundles/tool-registry/index.js'
import { LLMService, MockProvider } from '../src/bundles/model-adapter/index.js'
import { AgentLoop } from '../src/bundles/agent-loop/index.js'
import { Memory } from '../src/bundles/memory/index.js'
import { SubagentScope } from '../src/bundles/subagent-scope/index.js'
import { Orchestrator, type Plan } from '../src/bundles/orchestrator/index.js'

const ORIGINAL = 'export function add(a: number, b: number) {\n  return a - b\n}\n'
const FIXED = ORIGINAL.replace('a - b', 'a + b')
const README = '# demo\n'
const OTHER = 'export const answer = 42\n'
const RUN = 'run1'
const SID = 'e2e'
const READ_TOOLS = ['search_files', 'read_file']
const ALL_TOOLS = [...READ_TOOLS, 'write_file']
const PLAN: Plan = {
  task: 'Fix the bug in add() and confirm the fix.',
  subtasks: [
    { id: 's1', goal: 'find add() and report the corrected file', tools: READ_TOOLS, dependsOn: [] },
    { id: 's2', goal: 'write the corrected file', tools: ['write_file'], dependsOn: ['s1'] },
    { id: 's3', goal: 'read the file back and confirm the fix', tools: ['read_file'], dependsOn: ['s2'] },
  ],
}

const dirs: string[] = []
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

// ---- the independent audit ------------------------------------------------------------------------------------------------
interface Audit {
  /** A call named a tool outside the caller's grant (blocked or not). */
  attempted: { actor: string; tool: string }[]
  /** A call outside the grant that actually SUCCEEDED: the real violation. */
  executed: { actor: string; tool: string }[]
  /** Calls made by an actor that is not one of this run's sub-agents. */
  foreignActors: { actor: string; tool: string }[]
  /** tool.call events with no matching tool.result ("model-visible = logged" broken). */
  unpaired: { actor: string; tool: string }[]
}
function auditScopes(events: SessionEvent[], plan: Plan, runId: string): Audit {
  const grants = new Map(plan.subtasks.map((s) => [`subagent:${runId}-${s.id}`, new Set(s.tools)]))
  const out: Audit = { attempted: [], executed: [], foreignActors: [], unpaired: [] }
  const open = new Map<string, string[]>()
  for (const e of events) {
    const actor = e.actor ?? '(none)'
    if (e.type === 'tool.call') {
      const tool = (e.data as { name: string }).name
      const grant = grants.get(actor)
      if (!grant) out.foreignActors.push({ actor, tool })
      else if (!grant.has(tool)) out.attempted.push({ actor, tool })
      ;(open.get(actor) ?? open.set(actor, []).get(actor)!).push(tool)
    } else if (e.type === 'tool.result') {
      const d = e.data as { name: string; ok: boolean }
      const q = open.get(actor)
      if (q?.length) q.shift()
      const grant = grants.get(actor)
      if (d.ok && grant && !grant.has(d.name)) out.executed.push({ actor, tool: d.name })
    }
  }
  for (const [actor, q] of open) for (const tool of q) out.unpaired.push({ actor, tool })
  return out
}

// ---- the scripted "model" ---------------------------------------------------------------------------------------------------
type Block = { type: string; content?: string }
type Msg = { role: string; content: string | Block[] }
const turnOf = (m: Msg[]) => m.filter((x) => x.role === 'assistant').length
const resultsOf = (m: Msg[]): string[] => m.flatMap((x) => (Array.isArray(x.content) ? x.content.filter((b) => b.type === 'tool_result').map((b) => b.content ?? '') : []))
const use = (m: Msg[], name: string, input: unknown) => {
  const id = `c${turnOf(m)}`
  return { toolCalls: [{ id, name, input }], content: [{ type: 'tool_use' as const, id, name, input }] } as any
}
const say = (t: string) => ({ text: t, stopReason: 'end_turn' as const }) as any

async function boot(opts: { editorFails?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'harness-e2e-'))
  dirs.push(root)
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'math.ts'), ORIGINAL)
  await writeFile(join(root, 'src', 'other.ts'), OTHER)
  await writeFile(join(root, 'README.md'), README)
  const safe = (p: string) => {
    const abs = resolve(root, p)
    if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`path escapes the workspace: ${p}`)
    return abs
  }

  const snapshots: { atS2Start?: string } = {}
  const model = (req: { system?: string; messages: Msg[] }) => {
    const m = req.messages
    if (req.system?.includes('You are a planner')) return say(JSON.stringify({ subtasks: PLAN.subtasks }))
    const prompt = typeof m[0]!.content === 'string' ? m[0]!.content : ''
    const id = /Your subtask \((\w+)\)/.exec(prompt)?.[1]
    const t = turnOf(m)
    if (id === 's1') {
      if (t === 0) return use(m, 'search_files', { query: 'function add' })
      if (t === 1) return use(m, 'write_file', { path: 'src/math.ts', content: 'HACKED' }) // out of scope on purpose
      if (t === 2) return use(m, 'read_file', { path: /^(\S+?):/m.exec(resultsOf(m).find((r) => r.includes('function add')) ?? '')?.[1] ?? 'src/math.ts' })
      // the FILE read (starts with the source), not the search hit line, which merely mentions it
      const source = resultsOf(m).find((r) => r.startsWith('export function add')) ?? ''
      return say(`PATH: src/math.ts\nFIXED_CONTENT:\n${source.replace('a - b', 'a + b')}`)
    }
    if (id === 's2') {
      if (t === 0) snapshots.atS2Start = readFileSync(join(root, 'src', 'math.ts'), 'utf8')
      if (opts.editorFails) return say('')
      const dep = /<result id="s1">\n([\s\S]*?)\n<\/result>/.exec(prompt)?.[1] ?? ''
      const path = /PATH: (\S+)/.exec(dep)?.[1] ?? ''
      const content = /FIXED_CONTENT:\n([\s\S]*)$/.exec(dep)?.[1] ?? ''
      if (t === 0) return use(m, 'read_file', { path }) // out of scope on purpose
      if (t === 1) return use(m, 'write_file', { path, content })
      return say(`wrote ${path}`)
    }
    if (id === 's3') {
      if (t === 0) return use(m, 'read_file', { path: 'src/math.ts' })
      return say(resultsOf(m).some((r) => r.includes('a + b')) ? 'VERIFIED: add() now adds' : 'STILL BROKEN')
    }
    return say('unexpected request')
  }

  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(EgressPolicy, { projectId: 'e2e' })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LLMService, {})
  const mock = new MockProvider(model as any)
  ctx.llm.register('mock', mock, { default: true })
  await ctx.plugin(AgentLoop, {})
  const writes: { actor?: string; path: string }[] = []
  ctx.tools.register({
    name: 'search_files', description: 'find files containing text', actionClass: 'read-only',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    execute: async (i: any) => {
      const hits: string[] = []
      for (const f of ['src/math.ts', 'src/other.ts', 'README.md']) {
        const text = await readFile(join(root, f), 'utf8')
        text.split('\n').forEach((l, n) => { if (l.includes(i.query)) hits.push(`${f}:${n + 1}: ${l}`) })
      }
      return hits.join('\n') || 'no matches'
    },
  })
  ctx.tools.register({
    name: 'read_file', description: 'read a file', actionClass: 'read-only',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    execute: (i: any) => readFile(safe(i.path), 'utf8'),
  })
  ctx.tools.register({
    name: 'write_file', description: 'write a file', actionClass: 'real-fs-write',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    execute: async (i: any, tctx) => {
      await writeFile(safe(i.path), i.content)
      writes.push({ ...(tctx.actor ? { actor: tctx.actor } : {}), path: i.path })
      return 'written'
    },
  })
  await ctx.plugin(Memory, {})
  await ctx.memory.hot.add({ text: 'GLOBAL-RULE keep diffs minimal' })
  await ctx.memory.hot.add({ text: 'RESEARCH-ONLY-RULE cite line numbers', scope: `subagent:${RUN}-s1` })
  await ctx.memory.hot.add({ text: 'EDITOR-ONLY-RULE never touch other files', scope: `subagent:${RUN}-s2` })
  await ctx.plugin(SubagentScope)
  await ctx.plugin(Orchestrator, {})
  const disk = async (f: string) => readFile(join(root, f), 'utf8')
  return { ctx, mock, writes, snapshots, disk }
}

type Booted = Awaited<ReturnType<typeof boot>>
const runIt = async (b: Booted, o: { allowedTools?: string[]; onFailure?: 'abort' | 'continue' } = {}) => {
  const { plan } = await b.ctx.orchestrator.plan({ sessionId: SID, task: PLAN.task, tools: ALL_TOOLS })
  expect(plan.subtasks.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  return b.ctx.orchestrator.execute(plan, { sessionId: SID, allowedTools: o.allowedTools ?? ALL_TOOLS, runId: RUN, maxSteps: 8, ...(o.onFailure ? { onFailure: o.onFailure } : {}) })
}

describe('4.4: the task completes correctly, with each agent inside its scope', () => {
  it('plans, researches (read-only), edits (write-only), verifies, and the file on disk is actually fixed', async () => {
    const b = await boot()
    const r = await runIt(b)
    expect(r).toMatchObject({ status: 'completed', aborted: false })
    expect(r.subtasks.map((s) => `${s.id}:${s.status}`)).toEqual(['s1:completed', 's2:completed', 's3:completed'])
    expect(r.outputs['s3']).toBe('VERIFIED: add() now adds')
    // the real outcome, on disk
    expect(await b.disk('src/math.ts')).toBe(FIXED)
    expect(await b.disk('src/other.ts')).toBe(OTHER)
    expect(await b.disk('README.md')).toBe(README)
    // exactly one write, by the editor, to the right file
    expect(b.writes).toEqual([{ actor: `subagent:${RUN}-s2`, path: 'src/math.ts' }])
    expect(b.ctx.subagents.list()).toEqual([])
  })

  it('the log audit finds NO scope violation, while showing the two out-of-scope attempts that were blocked', async () => {
    const b = await boot()
    await runIt(b)
    const events = await b.ctx.log.read(SID)
    const a = auditScopes(events, PLAN, RUN)
    expect(a.executed).toEqual([]) // nothing outside a grant ever succeeded
    expect(a.foreignActors).toEqual([]) // every tool call came from one of this run's sub-agents
    expect(a.unpaired).toEqual([]) // every call has its result logged
    expect(a.attempted).toEqual([
      { actor: `subagent:${RUN}-s1`, tool: 'write_file' }, // the researcher tried to write
      { actor: `subagent:${RUN}-s2`, tool: 'read_file' }, // the editor tried to read
    ])
    // ...and each was refused by the registry, visibly, in the log
    const refused = events.filter((e) => e.type === 'tool.result' && (e.data as any).ok === false)
    expect(refused.map((e) => [e.actor, (e.data as any).name, (e.data as any).errorKind])).toEqual([
      [`subagent:${RUN}-s1`, 'write_file', 'denied'],
      [`subagent:${RUN}-s2`, 'read_file', 'denied'],
    ])
  })

  it('the researcher\'s write attempt changed nothing: the file was still original when the editor started', async () => {
    const b = await boot()
    await runIt(b)
    expect(b.snapshots.atS2Start).toBe(ORIGINAL)
  })

  it('the editor got the researcher\'s result through the dependency fence, and the verifier saw the editor\'s', async () => {
    const b = await boot()
    await runIt(b)
    const reqs = (await b.ctx.log.read(SID)).filter((e) => e.type === 'model.request')
    const first = (actor: string) => String(((reqs.find((e) => e.actor === actor)!.data as any).messages[0]).content)
    expect(first(`subagent:${RUN}-s2`)).toContain('<result id="s1">')
    expect(first(`subagent:${RUN}-s2`)).toContain('FIXED_CONTENT:')
    expect(first(`subagent:${RUN}-s3`)).toContain('<result id="s2">')
    expect(first(`subagent:${RUN}-s3`)).not.toContain('<result id="s1">') // s3 depends on s2 only
  })

  it('memory stays inside scope: each agent was shown its own scoped rule and the global one, never another agent\'s', async () => {
    const b = await boot()
    await runIt(b)
    const sys = async (actor: string) => (await b.ctx.log.read(SID)).filter((e) => e.type === 'model.request' && e.actor === actor).map((e) => String((e.data as any).system ?? '')).join('\n')
    const s1 = await sys(`subagent:${RUN}-s1`), s2 = await sys(`subagent:${RUN}-s2`), s3 = await sys(`subagent:${RUN}-s3`)
    expect(s1).toContain('RESEARCH-ONLY-RULE'); expect(s1).toContain('GLOBAL-RULE'); expect(s1).not.toContain('EDITOR-ONLY-RULE')
    expect(s2).toContain('EDITOR-ONLY-RULE'); expect(s2).toContain('GLOBAL-RULE'); expect(s2).not.toContain('RESEARCH-ONLY-RULE')
    expect(s3).toContain('GLOBAL-RULE'); expect(s3).not.toContain('RESEARCH-ONLY-RULE'); expect(s3).not.toContain('EDITOR-ONLY-RULE')
    // the planner (an orchestrator actor, not a sub-agent) sees no scoped rule either
    const planner = await sys('orchestrator')
    expect(planner).not.toContain('RESEARCH-ONLY-RULE'); expect(planner).not.toContain('EDITOR-ONLY-RULE')
    // each sub-agent's run was recorded as its own episode
    for (const id of ['s1', 's2', 's3']) expect(await b.ctx.memory.episodic.query({ agentId: `subagent:${RUN}-${id}` })).toHaveLength(1)
  })

  it('the log tells the whole story in order: plan, then execution, subtasks in dependency order, finished last', async () => {
    const b = await boot()
    await runIt(b)
    const evs = await b.ctx.log.read(SID)
    const at = (type: string, id?: string) => evs.findIndex((e) => e.type === type && (id === undefined || (e.data as any).id === id))
    const order = [at('plan.created'), at('execute.started'), at('subtask.started', 's1'), at('subtask.completed', 's1'), at('subtask.started', 's2'), at('subtask.completed', 's2'), at('subtask.started', 's3'), at('subtask.completed', 's3'), at('execute.finished')]
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((x, y) => x - y)).toEqual(order)
    expect(evs.at(-1)!.type).toBe('execute.finished')
    // the planner asked for a constrained reply whose tool names are exactly the offered tools
    const planReq = evs.find((e) => e.type === 'model.request' && e.actor === 'orchestrator')!.data as any
    expect(planReq.jsonSchema.properties.subtasks.items.properties.tools.items.enum).toEqual(ALL_TOOLS)
    // every model request in the run came from the planner or one of the three sub-agents
    expect(new Set(evs.filter((e) => e.type === 'model.request').map((e) => e.actor))).toEqual(new Set(['orchestrator', `subagent:${RUN}-s1`, `subagent:${RUN}-s2`, `subagent:${RUN}-s3`]))
  })
})

describe('4.4: a read-only run cannot write, and a failed edit leaves the disk alone', () => {
  it('a ceiling without write_file rejects the plan before anything runs: the file is untouched, and no sub-agent model call was made', async () => {
    const b = await boot()
    const { plan } = await b.ctx.orchestrator.plan({ sessionId: SID, task: PLAN.task, tools: ALL_TOOLS })
    const callsAfterPlanning = b.mock.calls.length
    await expect(b.ctx.orchestrator.execute(plan, { sessionId: SID, allowedTools: READ_TOOLS, runId: RUN })).rejects.toThrow(/write_file/)
    expect(b.mock.calls.length).toBe(callsAfterPlanning)
    expect(await b.disk('src/math.ts')).toBe(ORIGINAL)
    expect(b.writes).toEqual([])
  })

  it('if the editor fails, the run aborts: the verifier never runs, the file is still original, and the audit is still clean', async () => {
    const b = await boot({ editorFails: true })
    const r = await runIt(b)
    expect(r.subtasks.map((s) => `${s.id}:${s.status}`)).toEqual(['s1:completed', 's2:failed', 's3:not-run'])
    expect(r).toMatchObject({ status: 'failed', aborted: true })
    expect(Object.keys(r.outputs)).toEqual(['s1'])
    expect(await b.disk('src/math.ts')).toBe(ORIGINAL)
    expect(b.writes).toEqual([])
    const a = auditScopes(await b.ctx.log.read(SID), PLAN, RUN)
    expect(a.executed).toEqual([])
    expect(a.foreignActors).toEqual([])
  })
})

describe('4.4: the audit itself can detect violations (a test of the test)', () => {
  const doctored = async (edit: (events: SessionEvent[]) => SessionEvent[]) => {
    const b = await boot()
    await runIt(b)
    return auditScopes(edit(structuredClone(await b.ctx.log.read(SID))), PLAN, RUN)
  }
  it('flags an out-of-scope call that succeeded', async () => {
    const a = await doctored((evs) => {
      const denied = evs.find((e) => e.type === 'tool.result' && (e.data as any).ok === false)!
      ;(denied.data as any).ok = true
      return evs
    })
    expect(a.executed).toEqual([{ actor: `subagent:${RUN}-s1`, tool: 'write_file' }])
  })
  it('flags a tool call by an actor that is not one of the run\'s sub-agents', async () => {
    const a = await doctored((evs) => {
      const call = evs.find((e) => e.type === 'tool.call')!
      call.actor = 'main'
      return evs
    })
    expect(a.foreignActors).toHaveLength(1)
    expect(a.foreignActors[0]!.actor).toBe('main')
  })
  it('flags a tool call whose result was never logged', async () => {
    const a = await doctored((evs) => {
      const i = evs.findIndex((e) => e.type === 'tool.result')
      evs.splice(i, 1)
      return evs
    })
    expect(a.unpaired.length).toBeGreaterThan(0)
  })
})
