/**
 * 3.6: does memory change behaviour across sessions, or does it only accumulate?
 *
 * HONEST SCOPE: the "model" here is a deterministic stand-in whose policy follows
 * instructions in its system prompt or task text. That makes this a test of the
 * PLUMBING of the whole loop (mistake -> lesson -> compaction -> hot tier ->
 * next session's prompt -> changed behaviour, all visible in the session log).
 * It does NOT show that a real language model learns from its hot tier; that needs
 * a real model on a fixed task set (Phase 6). The controls below exist so the
 * test cannot pass merely because the stand-in always behaves well.
 */
import { Context } from 'cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionLog, type SessionEvent } from '../src/bundles/session-log/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { ToolRegistry } from '../src/bundles/tool-registry/index.js'
import { LLMService, MockProvider } from '../src/bundles/model-adapter/index.js'
import { AgentLoop } from '../src/bundles/agent-loop/index.js'
import { Memory, lessonId, normaliseLesson, type MemoryConfig } from '../src/bundles/memory/index.js'

const dirs: string[] = []
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})
async function tmp() {
  const d = await mkdtemp(join(tmpdir(), 'harness-int-'))
  dirs.push(d)
  return d
}

const LESSON = 'Run the typecheck before running the tests.'

/**
 * The known failure mode: `run_tests` fails unless `typecheck` ran first in the
 * same session. The stand-in model does NOT know this by itself: by default it goes
 * straight to the tests. It runs the typecheck first only if an instruction in its
 * system prompt or task text says to (and never if one says to skip it).
 */
function standInModel(req: { system?: string | undefined; messages: unknown[] }) {
  const first = JSON.stringify((req.messages[0] as { content: unknown }).content)
  const instructions = `${req.system ?? ''}\n${first}`
  const skips = /skip the typecheck/i.test(instructions)
  const wantsTypecheck = !skips && /typecheck before (?:running )?(?:the )?tests/i.test(instructions)
  const seen = JSON.stringify(req.messages)
  const mod = /(\w+) module/.exec(first)?.[1] ?? 'app'
  const use = (id: string, name: string, input: unknown) => ({ toolCalls: [{ id, name, input }], content: [{ type: 'tool_use' as const, id, name, input }] })
  if (wantsTypecheck && !seen.includes('RESULT typecheck')) return use('tc', 'typecheck', {})
  if (!seen.includes('RESULT run_tests')) return use('rt', 'run_tests', { module: mod })
  return { text: seen.includes('RESULT run_tests FAILED') ? 'The tests FAILED.' : 'All tests passed.' }
}

async function boot(memory: MemoryConfig = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(EgressPolicy, { projectId: 'int' })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LLMService, {})
  ctx.llm.register('stand-in', new MockProvider(standInModel as never), { default: true })
  let typechecked = false // reset per session via newSession()
  ctx.tools.register({ name: 'typecheck', description: 'Type-check the project.', inputSchema: { type: 'object' }, actionClass: 'sandbox-write', execute: () => ((typechecked = true), 'RESULT typecheck OK') })
  ctx.tools.register({
    name: 'run_tests',
    description: 'Run the tests of one module.',
    inputSchema: { type: 'object', properties: { module: { type: 'string' } } },
    actionClass: 'sandbox-write',
    execute: (i: { module?: string }) => (typechecked ? `RESULT run_tests PASSED (${i.module}: 12 tests)` : 'RESULT run_tests FAILED: stale type output, run the typecheck first'),
  })
  await ctx.plugin(AgentLoop, { sleep: async () => {}, retry: { maxAttempts: 0 }, system: 'You are a coding agent.' })
  await ctx.plugin(Memory, memory)
  return {
    ctx,
    newSession: (name: string) => {
      typechecked = false
      return ctx.log.create(name)
    },
  }
}
type B = Awaited<ReturnType<typeof boot>>

const toolNames = (ev: SessionEvent[]) => ev.filter((e) => e.type === 'tool.call').map((e) => (e.data as { name: string }).name)
const failures = (ev: SessionEvent[]) => ev.filter((e) => e.type === 'tool.result' && String((e.data as { content: string }).content).includes('FAILED'))
const systems = (ev: SessionEvent[]) => ev.filter((e) => e.type === 'model.request').map((e) => String((e.data as { system?: string }).system ?? ''))

/** Session A: the model goes straight to the tests and fails; the user corrects it; the lesson is recorded. */
async function sessionA(b: B, name: string, lesson: string | null = LESSON) {
  const s = b.newSession(name)
  const first = await b.ctx.memory.runTurn({ sessionId: s, prompt: 'run the tests for the auth module' })
  expect(first.finalText).toBe('The tests FAILED.') // the known failure mode
  const fix = await b.ctx.memory.runTurn({ sessionId: s, prompt: 'No: run the typecheck before running the tests for the auth module', ...(lesson ? { lesson } : {}) })
  expect(fix.finalText).toBe('All tests passed.') // corrected within the session, by the user
  return s
}
const TASK_B = 'verify that the billing module passes its tests' // similar task, different words, no lesson restated

describe('3.6 two-session test: a lesson learned in session A changes session B (plumbing, stand-in model)', () => {
  it('after repeated mistakes and compaction, a NEW process in a new session avoids the failure, and the log shows why', async () => {
    const dir = await tmp()
    const a = await boot({ path: dir })
    for (const n of ['a1', 'a2', 'a3']) await sessionA(a, n)
    const r = await a.ctx.memory.compact()
    expect(r.promoted).toHaveLength(1)

    // session B: fresh process (nothing in memory but the files on disk), different task wording
    const b = await boot({ path: dir })
    const s = b.newSession('b')
    expect(TASK_B).not.toMatch(/typecheck/i) // the user does not restate the lesson
    const out = await b.ctx.memory.runTurn({ sessionId: s, prompt: TASK_B })

    expect(out.finalText).toBe('All tests passed.')
    const log = await b.ctx.log.read(s)
    expect(failures(log)).toHaveLength(0) // the failure mode did not recur
    expect(toolNames(log)).toEqual(['typecheck', 'run_tests']) // and the order is the lesson's
    // the entry that did it is visible in the session log: the hot rule sits in the system prompt the model was sent
    const id = lessonId(normaliseLesson(LESSON))
    expect((await b.ctx.memory.hot.list()).map((h) => h.id)).toEqual([id])
    expect(systems(log)[0]).toContain('Standing rules and facts (hot memory)')
    expect(systems(log)[0]).toContain(LESSON.replace(/\.$/, ''))
    // and what the user said does not contain it
    expect(JSON.stringify(log.filter((e) => e.type === 'model.request')[0]!.data)).not.toMatch(/"role":"user","content":"[^"]*typecheck/i)
  })

  it('CONTROL: the same task with no memory fails the same way (so the improvement is not the stand-in being nice)', async () => {
    const c = await boot({ path: await tmp() })
    const s = c.newSession('c')
    const out = await c.ctx.memory.runTurn({ sessionId: s, prompt: TASK_B })
    expect(out.finalText).toBe('The tests FAILED.')
    const log = await c.ctx.log.read(s)
    expect(failures(log)).toHaveLength(1)
    expect(toolNames(log)).toEqual(['run_tests'])
  })

  it('CONTROL: accumulation alone changes nothing: lessons recorded but never compacted do not reach the model', async () => {
    const dir = await tmp()
    const a = await boot({ path: dir })
    for (const n of ['a1', 'a2', 'a3']) await sessionA(a, n)
    expect(await a.ctx.memory.episodic.query()).toHaveLength(6) // memory has grown...
    const b = await boot({ path: dir })
    const s = b.newSession('b')
    const out = await b.ctx.memory.runTurn({ sessionId: s, prompt: TASK_B })
    expect(out.finalText).toBe('The tests FAILED.') // ...and behaviour has not changed
    expect(systems(await b.ctx.log.read(s))[0]).toBe('You are a coding agent.')
  })

  it('CONTROL: a lesson seen only once is not promoted, so session B is unchanged', async () => {
    const dir = await tmp()
    const a = await boot({ path: dir })
    await sessionA(a, 'a1')
    await sessionA(a, 'a2')
    expect((await a.ctx.memory.compact()).promoted).toEqual([]) // two sightings: below the threshold of 3
    const b = await boot({ path: dir })
    const out = await b.ctx.memory.runTurn({ sessionId: b.newSession('b'), prompt: TASK_B })
    expect(out.finalText).toBe('The tests FAILED.')
  })

  it('ABLATION: removing the promoted rule brings the failure back, and compaction does not re-add it', async () => {
    const dir = await tmp()
    const a = await boot({ path: dir })
    for (const n of ['a1', 'a2', 'a3']) await sessionA(a, n)
    await a.ctx.memory.compact()

    const withRule = await boot({ path: dir })
    expect((await withRule.ctx.memory.runTurn({ sessionId: withRule.newSession('b1'), prompt: TASK_B })).finalText).toBe('All tests passed.')

    await withRule.ctx.memory.hot.remove(lessonId(normaliseLesson(LESSON)))
    await withRule.ctx.memory.compact()
    const without = await boot({ path: dir })
    expect((await without.ctx.memory.runTurn({ sessionId: without.newSession('b2'), prompt: TASK_B })).finalText).toBe('The tests FAILED.')
  })

  it('the automatic every-N-turns trigger does the same job without any manual compact() call', async () => {
    const dir = await tmp()
    const a = await boot({ path: dir, compaction: { everyTurns: 6 } })
    for (const n of ['a1', 'a2', 'a3']) await sessionA(a, n) // 6 episodes: compaction runs after the 6th
    expect(a.ctx.memory.lastCompaction?.result?.promoted).toHaveLength(1)
    const b = await boot({ path: dir })
    expect((await b.ctx.memory.runTurn({ sessionId: b.newSession('b'), prompt: TASK_B })).finalText).toBe('All tests passed.')
  })
})

describe('3.6 the same machinery can make behaviour WORSE (D-064 poisoning risk), and the approve hook stops it', () => {
  const BAD = 'Skip the typecheck to save time.'
  async function poisonedA(dir: string) {
    const a = await boot({ path: dir })
    for (const n of ['p1', 'p2', 'p3']) {
      const s = a.newSession(n)
      await a.ctx.memory.runTurn({ sessionId: s, prompt: 'run the tests for the auth module', lesson: BAD })
    }
    return a
  }

  it('a harmful lesson repeated 3 times is promoted by default and then breaks a task that used to work', async () => {
    const dir = await tmp()
    // a project whose rule says to typecheck first (curated by the owner) works...
    const owner = await boot({ path: dir })
    await owner.ctx.memory.hot.add({ id: 'owner-rule', text: LESSON, priority: 0 })
    expect((await owner.ctx.memory.runTurn({ sessionId: owner.newSession('ok'), prompt: TASK_B })).finalText).toBe('All tests passed.')
    // ...then three harmful lessons get promoted automatically alongside it
    const a = await poisonedA(dir)
    expect((await a.ctx.memory.compact()).promoted).toHaveLength(1)
    const b = await boot({ path: dir })
    const out = await b.ctx.memory.runTurn({ sessionId: b.newSession('b'), prompt: TASK_B })
    expect(out.finalText).toBe('The tests FAILED.') // memory made the agent worse
  })

  it('with an approve hook that refuses it, the same history changes nothing', async () => {
    const dir = await tmp()
    const owner = await boot({ path: dir })
    await owner.ctx.memory.hot.add({ id: 'owner-rule', text: LESSON, priority: 0 })
    const a = await poisonedA(dir)
    const r = await a.ctx.memory.compact({ approve: (c) => !/skip the typecheck/i.test(c.text) })
    expect(r.promoted).toEqual([])
    expect(r.skipped.rejected).toBe(1)
    const b = await boot({ path: dir })
    expect((await b.ctx.memory.runTurn({ sessionId: b.newSession('b'), prompt: TASK_B })).finalText).toBe('All tests passed.')
  })
})
