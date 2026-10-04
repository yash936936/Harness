import { Context } from 'cordis'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { ToolRegistry } from '../src/bundles/tool-registry/index.js'
import { LLMService, MockProvider } from '../src/bundles/model-adapter/index.js'
import { AgentLoop } from '../src/bundles/agent-loop/index.js'
import { Memory, MemoryError, lessonId, normaliseLesson, type MemoryConfig } from '../src/bundles/memory/index.js'

const dirs: string[] = []
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})
async function tmp() {
  const d = await mkdtemp(join(tmpdir(), 'harness-cmp-'))
  dirs.push(d)
  return d
}

async function boot(memory: MemoryConfig = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(EgressPolicy, { projectId: 'test' })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LLMService, {})
  const provider = new MockProvider(() => ({ text: 'ok' }))
  ctx.llm.register('mock', provider, { default: true })
  await ctx.plugin(AgentLoop, { sleep: async () => {}, retry: { maxAttempts: 0 } })
  await ctx.plugin(Memory, memory)
  return { ctx, provider }
}
type C = Awaited<ReturnType<typeof boot>>['ctx']
let n = 0
const turn = (ctx: C, lesson: string | null, session = 's1') => ctx.memory.runTurn({ sessionId: session, prompt: `task ${++n}`, ...(lesson !== null ? { lesson } : {}) })
async function session(ctx: C, name: string) {
  return ctx.log.create(name)
}

const LESSON = 'Run the typecheck before running the tests.'

describe('compaction (3.4): promotes a recurring lesson', () => {
  it('3 episodes with the same lesson (different casing/punctuation, two sessions) -> exactly one hot entry; one-off and null lessons are ignored', async () => {
    const { ctx } = await boot()
    const a = await session(ctx, 'a')
    const b = await session(ctx, 'b')
    await turn(ctx, 'Run the typecheck before running the tests.', a)
    await turn(ctx, '  run the TYPECHECK before running the tests  ', a)
    await turn(ctx, 'Run the typecheck before running the tests!', b)
    await turn(ctx, 'Never edit generated files by hand.', b) // seen once
    await turn(ctx, null, b) // no lesson

    const r = await ctx.memory.compact()
    expect(r.examined).toBe(5)
    expect(r.promoted).toHaveLength(1)
    expect(r.promoted[0]).toMatchObject({ occurrences: 3, sessions: 2, text: 'Run the typecheck before running the tests!' })
    expect(r.skipped.belowThreshold).toBe(1)

    const hot = await ctx.memory.hot.list()
    expect(hot).toHaveLength(1)
    expect(hot[0]).toMatchObject({ id: lessonId(normaliseLesson(LESSON)), source: 'compaction', priority: -1, text: 'Run the typecheck before running the tests!' })
  })

  it('below the threshold nothing is promoted; the third occurrence tips it over', async () => {
    const { ctx } = await boot()
    const s = await session(ctx, 's')
    await turn(ctx, LESSON, s)
    await turn(ctx, LESSON, s)
    expect((await ctx.memory.compact()).promoted).toEqual([])
    expect(await ctx.memory.hot.list()).toEqual([])
    await turn(ctx, LESSON, s)
    expect((await ctx.memory.compact()).promoted).toHaveLength(1)
  })

  it('is idempotent: a second run promotes nothing and does not touch the entry', async () => {
    const { ctx } = await boot()
    const s = await session(ctx, 's')
    for (let i = 0; i < 3; i++) await turn(ctx, LESSON, s)
    await ctx.memory.compact()
    const before = await ctx.memory.hot.list()
    const again = await ctx.memory.compact()
    expect(again.promoted).toEqual([])
    expect(again.skipped.alreadyPromoted).toBe(1)
    expect(await ctx.memory.hot.list()).toEqual(before) // same id, same ts: not rewritten
    await ctx.memory.compact()
    expect(await ctx.memory.hot.list()).toHaveLength(1)
  })

  it('crash recovery: a rule already in the hot tier but missing from the ledger is adopted (not rewritten), and a later removal then sticks', async () => {
    const dir = await tmp()
    const { ctx } = await boot({ path: dir })
    const s = await session(ctx, 's')
    for (let i = 0; i < 3; i++) await turn(ctx, LESSON, s)
    // simulate a crash between the hot write and the ledger write: the rule is in hot.json, compaction.json does not exist
    const id = lessonId(normaliseLesson(LESSON))
    await ctx.memory.hot.add({ id, text: 'edited by the owner meanwhile', priority: 7, source: 'compaction' })
    const before = await ctx.memory.hot.list()

    const r = await ctx.memory.compact()
    expect(r.promoted).toEqual([]) // nothing newly promoted
    expect(r.skipped.alreadyPromoted).toBe(1)
    expect(await ctx.memory.hot.list()).toEqual(before) // the owner's edited text and priority are untouched

    // it is now in the ledger, so removing it sticks
    await ctx.memory.hot.remove(id)
    expect((await ctx.memory.compact()).promoted).toEqual([])
    expect(await ctx.memory.hot.list()).toEqual([])
  })

  it('a rule the owner removed stays removed, even across a restart', async () => {
    const dir = await tmp()
    const { ctx } = await boot({ path: dir })
    const s = await session(ctx, 's')
    for (let i = 0; i < 3; i++) await turn(ctx, LESSON, s)
    const [p] = (await ctx.memory.compact()).promoted
    await ctx.memory.hot.remove(p!.id)

    const again = await ctx.memory.compact()
    expect(again.promoted).toEqual([])
    expect(await ctx.memory.hot.list()).toEqual([])

    // new process: same files. Episodes are persisted; the session log is not needed for compaction.
    const { ctx: ctx2 } = await boot({ path: dir })
    const r2 = await ctx2.memory.compact()
    expect(r2.promoted).toEqual([])
    expect(r2.skipped.alreadyPromoted).toBe(1)
    expect(await ctx2.memory.hot.list()).toEqual([])
  })

  it('persisted: a restart does not promote it a second time', async () => {
    const dir = await tmp()
    const { ctx } = await boot({ path: dir })
    const s = await session(ctx, 's')
    for (let i = 0; i < 3; i++) await turn(ctx, LESSON, s)
    await ctx.memory.compact()
    const { ctx: ctx2 } = await boot({ path: dir })
    expect((await ctx2.memory.compact()).promoted).toEqual([])
    expect(await ctx2.memory.hot.list()).toHaveLength(1)
  })

  it('a promoted rule reaches the model on the next run (3.2 + 3.4 together)', async () => {
    const { ctx, provider } = await boot()
    const s = await session(ctx, 's')
    for (let i = 0; i < 3; i++) await turn(ctx, LESSON, s)
    expect(provider.calls.every((c) => !c.system)).toBe(true)
    await ctx.memory.compact()
    await ctx.agentLoop.run({ sessionId: s, prompt: 'next task' })
    expect(provider.calls[provider.calls.length - 1]!.system).toContain('Run the typecheck before running the tests')
  })

  it('promoted rules rank below curated ones: under a tight cap the curated rule survives and the promoted one is dropped', async () => {
    // header 14 + curated line 13 = 27 <= 30, but adding the promoted line (8) = 35 > 30
    const { ctx } = await boot({ hotTokenCap: 30 })
    const s = await session(ctx, 's')
    const lesson = 'Prefer small diffs.'
    for (let i = 0; i < 3; i++) await turn(ctx, lesson, s)
    await ctx.memory.hot.add({ id: 'curated', text: 'Never force-push to main branch ever' }) // default priority 0
    await ctx.memory.compact()
    const r = await ctx.memory.hot.render()
    expect(r.included).toEqual(['curated'])
    expect(r.dropped).toEqual([lessonId(normaliseLesson(lesson))])
  })
})

describe('compaction (3.4): safeguards', () => {
  it('dryRun reports candidates and writes nothing; approve can veto, and a veto is asked again next run (not remembered)', async () => {
    const { ctx } = await boot()
    const s = await session(ctx, 's')
    for (let i = 0; i < 3; i++) await turn(ctx, LESSON, s)

    const dry = await ctx.memory.compact({ dryRun: true })
    expect(dry.dryRun).toBe(true)
    expect(dry.promoted).toHaveLength(1)
    expect(await ctx.memory.hot.list()).toEqual([])

    const veto = await ctx.memory.compact({ approve: () => false })
    expect(veto.promoted).toEqual([])
    expect(veto.skipped.rejected).toBe(1)
    expect(await ctx.memory.hot.list()).toEqual([])

    const asked: string[] = []
    const ok = await ctx.memory.compact({ approve: (c) => (asked.push(c.text), true) })
    expect(asked).toHaveLength(1)
    expect(ok.promoted).toHaveLength(1)
  })

  it('a lesson too large for the hot tier is reported as failed, does not abort the run, and is retried later', async () => {
    const { ctx } = await boot({ hotTokenCap: 60 })
    const s = await session(ctx, 's')
    const huge = 'x'.repeat(400)
    for (let i = 0; i < 3; i++) await turn(ctx, huge, s)
    for (let i = 0; i < 3; i++) await turn(ctx, 'Keep it short.', s)
    const r = await ctx.memory.compact()
    expect(r.promoted.map((p) => p.text)).toEqual(['Keep it short.'])
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0]!.reason).toMatch(/too large/)
    expect((await ctx.memory.compact()).failed).toHaveLength(1) // not remembered as done
  })

  it('secrets in a lesson are redacted by the hot tier on the way in', async () => {
    const { ctx } = await boot()
    ctx.egress.registerSecret('k', 'sk-cmp-123')
    const s = await session(ctx, 's')
    // the episode already stores the redacted text, and so does the hot entry
    for (let i = 0; i < 3; i++) await turn(ctx, 'Use sk-cmp-123 for the staging api', s)
    await ctx.memory.compact()
    expect(JSON.stringify(await ctx.memory.hot.list())).not.toContain('sk-cmp-123')
  })

  it('refuses nonsense thresholds, and a corrupt ledger is refused rather than overwritten', async () => {
    const { ctx } = await boot()
    await expect(ctx.memory.compact({ minOccurrences: 1 })).rejects.toThrow(MemoryError)
    await expect(boot({ compaction: { minOccurrences: 1 } })).rejects.toThrow()
    const dir = await tmp()
    await writeFile(join(dir, 'compaction.json'), '{ nope', 'utf8')
    const { ctx: c2 } = await boot({ path: dir })
    const s = await session(c2, 's')
    for (let i = 0; i < 3; i++) await turn(c2, LESSON, s)
    await expect(c2.memory.compact()).rejects.toThrow(/unreadable/)
  })

  it('overlapping runs cannot promote the same lesson twice', async () => {
    const { ctx } = await boot()
    const s = await session(ctx, 's')
    for (let i = 0; i < 3; i++) await turn(ctx, LESSON, s)
    const rs = await Promise.all([ctx.memory.compact(), ctx.memory.compact(), ctx.memory.compact()])
    expect(rs.reduce((a, r) => a + r.promoted.length, 0)).toBe(1)
    expect(await ctx.memory.hot.list()).toHaveLength(1)
  })
})

describe('compaction (3.4): the every-N-turns trigger', () => {
  it('runs after every Nth episode, counted from stored episodes, and promotes without a manual call', async () => {
    const { ctx } = await boot({ compaction: { everyTurns: 3 } })
    const s = await session(ctx, 's')
    await turn(ctx, LESSON, s)
    await turn(ctx, LESSON, s)
    expect(ctx.memory.lastCompaction).toBeUndefined()
    await turn(ctx, LESSON, s) // third episode: compaction runs now
    expect(ctx.memory.lastCompaction?.result?.promoted).toHaveLength(1)
    expect(await ctx.memory.hot.list()).toHaveLength(1)
    await turn(ctx, LESSON, s) // 4th: not a multiple of 3
    expect(ctx.memory.lastCompaction?.result?.promoted).toHaveLength(1) // unchanged
  })

  it('a compaction failure never fails the user turn; it is recorded in lastCompaction', async () => {
    const dir = await tmp()
    await writeFile(join(dir, 'hot.json'), '{ broken', 'utf8') // makes hot.list() throw inside compaction
    const { ctx } = await boot({ path: dir, compaction: { everyTurns: 1 }, injectHot: false })
    const s = await session(ctx, 's')
    const r = await turn(ctx, LESSON, s) // must resolve
    expect(r.finalText).toBe('ok')
    expect(ctx.memory.lastCompaction?.error).toMatch(/unreadable/)
  })

  it('everyTurns must be a positive integer', async () => {
    await expect(boot({ compaction: { everyTurns: 0 } })).rejects.toThrow()
  })
})

describe('compaction (3.4): lesson identity', () => {
  it('normalises case, whitespace and edge punctuation only', () => {
    expect(normaliseLesson('  Run   the TESTS!! ')).toBe('run the tests')
    expect(normaliseLesson('Run the tests')).toBe(normaliseLesson('run the tests.'))
    expect(normaliseLesson('Run the tests first')).not.toBe(normaliseLesson('Run the tests'))
    expect(lessonId('a')).toBe(lessonId('a'))
    expect(lessonId('a')).not.toBe(lessonId('b'))
  })
})
