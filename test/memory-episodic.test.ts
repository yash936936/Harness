import { Context } from 'cordis'
import { mkdtemp, rm, appendFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { ToolRegistry } from '../src/bundles/tool-registry/index.js'
import { LLMError, LLMService, MockProvider } from '../src/bundles/model-adapter/index.js'
import { AgentLoop } from '../src/bundles/agent-loop/index.js'
import { Memory, MemoryError, summariseApproach, type MemoryConfig } from '../src/bundles/memory/index.js'

const dirs: string[] = []
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})
async function tmp() {
  const d = await mkdtemp(join(tmpdir(), 'harness-mem-'))
  dirs.push(d)
  return d
}

const toolTurn = (id: string, name: string) => ({ toolCalls: [{ id, name, input: {} }], content: [{ type: 'tool_use' as const, id, name, input: {} }] })

async function boot(script: ConstructorParameters<typeof MockProvider>[0], memory: MemoryConfig = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(EgressPolicy, { projectId: 'test' })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LLMService, {})
  ctx.llm.register('mock', new MockProvider(script), { default: true })
  ctx.tools.register({ name: 'read', description: 'r', inputSchema: { type: 'object' }, actionClass: 'read-only', execute: () => 'x' })
  ctx.tools.register({ name: 'search', description: 's', inputSchema: { type: 'object' }, actionClass: 'read-only', execute: () => 'y' })
  await ctx.plugin(AgentLoop, { sleep: async () => {}, retry: { maxAttempts: 0 } })
  await ctx.plugin(Memory, memory)
  return ctx
}

describe('memory: episodic tier (3.1)', () => {
  it('N turns produce exactly N entries, each linked to its own non-overlapping session-log range', async () => {
    const ctx = await boot([
      toolTurn('a', 'search'), { text: 'first answer' },
      { text: 'second answer' },
      toolTurn('b', 'read'), toolTurn('c', 'read'), { text: 'third answer' },
    ])
    const s = ctx.log.create('s1')
    const r1 = await ctx.memory.runTurn({ sessionId: s, prompt: 'task one' })
    const r2 = await ctx.memory.runTurn({ sessionId: s, prompt: 'task two' })
    const r3 = await ctx.memory.runTurn({ sessionId: s, prompt: 'task three' })

    const all = await ctx.memory.episodic.query({ sessionId: s })
    expect(all).toHaveLength(3)
    expect(all.map((e) => e.task)).toEqual(['task one', 'task two', 'task three'])
    expect(all.map((e) => e.result)).toEqual(['first answer', 'second answer', 'third answer'])
    expect(r1.episode.id).toBe(all[0]!.id)

    // ranges are contiguous, start at 1, never overlap, and the last one ends at the log's last seq
    expect(all[0]!.fromSeq).toBe(1)
    for (let i = 1; i < all.length; i++) expect(all[i]!.fromSeq).toBe(all[i - 1]!.toSeq + 1)
    const events = await ctx.log.read(s)
    expect(all[2]!.toSeq).toBe(events[events.length - 1]!.seq)

    // linkage is real, not asserted by construction: count tool.call events inside each range
    for (const e of all) {
      const inRange = events.filter((x) => x.seq >= e.fromSeq && x.seq <= e.toSeq && x.type === 'tool.call')
      expect(e.toolCalls).toBe(inRange.length)
      expect(await ctx.memory.episodic.verifyLink(e)).toBe(true)
    }
    expect(all.map((e) => e.toolCalls)).toEqual([1, 0, 2])
    expect(all.map((e) => e.approach)).toEqual(['search', 'no tools used', 'read x2'])
    expect([r1.steps, r2.steps, r3.steps]).toEqual([2, 1, 3])
  })

  it('writing the same turn twice does not create a second entry', async () => {
    const ctx = await boot([{ text: 'answer' }])
    const s = ctx.log.create('s1')
    const r = await ctx.memory.runTurn({ sessionId: s, prompt: 'task' })
    const again = await ctx.memory.episodic.record({ sessionId: s, task: 'task', fromSeq: r.episode.fromSeq, toSeq: r.episode.toSeq, outcome: 'done', result: 'answer' })
    expect(again.created).toBe(false)
    expect(await ctx.memory.episodic.query()).toHaveLength(1)
  })

  it('never invents a lesson: null unless the caller supplies one', async () => {
    const ctx = await boot([{ text: 'a' }, { text: 'b' }])
    const s = ctx.log.create('s1')
    const r1 = await ctx.memory.runTurn({ sessionId: s, prompt: 't1' })
    const r2 = await ctx.memory.runTurn({ sessionId: s, prompt: 't2', lesson: 'check the lockfile first' })
    expect(r1.episode.lesson).toBeNull()
    expect(r2.episode.lesson).toBe('check the lockfile first')
  })

  it('a max_steps turn is recorded with that outcome', async () => {
    const ctx = await boot(() => toolTurn('x', 'read'))
    const s = ctx.log.create('s1')
    const r = await ctx.memory.runTurn({ sessionId: s, prompt: 'loop forever', maxSteps: 2 })
    expect(r.stopReason).toBe('max_steps')
    const [e] = await ctx.memory.episodic.query()
    expect(e!.outcome).toBe('max_steps')
    expect(e!.steps).toBe(2)
    expect(e!.toolCalls).toBe(2)
  })

  it('a failed turn writes one error entry and rethrows the original error', async () => {
    const err = new LLMError('quota', 'daily quota spent', 'mock')
    const ctx = await boot([err])
    const s = ctx.log.create('s1')
    await expect(ctx.memory.runTurn({ sessionId: s, prompt: 'doomed' })).rejects.toBe(err)
    const all = await ctx.memory.episodic.query()
    expect(all).toHaveLength(1)
    expect(all[0]!.outcome).toBe('error')
    expect(all[0]!.result).toContain('daily quota spent')
    expect(await ctx.memory.episodic.verifyLink(all[0]!)).toBe(true)
  })

  it('queries by agent, task text, outcome, session and time range (and orders/limits)', async () => {
    let t = Date.parse('2026-10-01T00:00:00Z')
    const ctx = await boot([{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }], { now: () => new Date((t += 3_600_000)) })
    const s = ctx.log.create('s1')
    const s2 = ctx.log.create('s2')
    await ctx.memory.runTurn({ sessionId: s, prompt: 'Fix the parser', actor: 'coder' }) // 01:00
    await ctx.memory.runTurn({ sessionId: s, prompt: 'Read the docs', actor: 'researcher' }) // 02:00
    await ctx.memory.runTurn({ sessionId: s2, prompt: 'fix the lexer', actor: 'coder' }) // 03:00
    await ctx.memory.runTurn({ sessionId: s, prompt: 'Write tests', actor: 'coder' }) // 04:00
    const q = (x: Parameters<typeof ctx.memory.episodic.query>[0]) => ctx.memory.episodic.query(x).then((r) => r.map((e) => e.task))

    expect(await q({ agentId: 'coder' })).toEqual(['Fix the parser', 'fix the lexer', 'Write tests'])
    expect(await q({ agentId: 'researcher' })).toEqual(['Read the docs'])
    expect(await q({ task: 'FIX' })).toEqual(['Fix the parser', 'fix the lexer'])
    expect(await q({ sessionId: s2 })).toEqual(['fix the lexer'])
    // [02:00, 04:00): from inclusive, to exclusive
    expect(await q({ from: '2026-10-01T02:00:00.000Z', to: '2026-10-01T04:00:00.000Z' })).toEqual(['Read the docs', 'fix the lexer'])
    // the combination must narrow, not union
    expect(await q({ agentId: 'coder', from: '2026-10-01T02:00:00.000Z', to: '2026-10-01T04:00:00.000Z' })).toEqual(['fix the lexer'])
    expect(await q({ agentId: 'nobody' })).toEqual([])
    expect(await q({ order: 'desc', limit: 2 })).toEqual(['Write tests', 'fix the lexer'])
    expect(await q({ outcome: 'error' })).toEqual([])
  })

  it('a registered secret in the task or answer is redacted before it is stored', async () => {
    const ctx = await boot([{ text: 'the key is sk-live-12345' }])
    ctx.egress.registerSecret('openrouter', 'sk-live-12345')
    const s = ctx.log.create('s1')
    await ctx.memory.runTurn({ sessionId: s, prompt: 'use sk-live-12345 to call the api' })
    const [e] = await ctx.memory.episodic.query()
    expect(JSON.stringify(e)).not.toContain('sk-live-12345')
    expect(e!.task).toContain('[redacted:openrouter]')
    expect(e!.result).toContain('[redacted:openrouter]')
  })

  it('long fields are clipped to maxFieldChars', async () => {
    const ctx = await boot([{ text: 'z'.repeat(500) }], { maxFieldChars: 50 })
    const s = ctx.log.create('s1')
    await ctx.memory.runTurn({ sessionId: s, prompt: 'p'.repeat(500) })
    const [e] = await ctx.memory.episodic.query()
    expect(e!.task.length).toBe(50)
    expect(e!.result.length).toBe(50)
  })

  it('rejects a bad range or a range with no events instead of writing a dangling entry', async () => {
    const ctx = await boot([{ text: 'a' }])
    const s = ctx.log.create('s1')
    await ctx.memory.runTurn({ sessionId: s, prompt: 't' })
    const rec = (fromSeq: number, toSeq: number) => ctx.memory.episodic.record({ sessionId: s, task: 't', fromSeq, toSeq, outcome: 'done', result: '' })
    await expect(rec(0, 1)).rejects.toThrow(MemoryError)
    await expect(rec(3, 2)).rejects.toThrow(MemoryError)
    await expect(rec(900, 901)).rejects.toThrow(MemoryError)
    expect(await ctx.memory.episodic.query()).toHaveLength(1)
  })

  it('persists to disk, survives a restart, and does not duplicate a turn after the restart', async () => {
    const dir = await tmp()
    const ctx1 = await boot([{ text: 'a' }], { path: dir })
    const s = ctx1.log.create('s1')
    const r = await ctx1.memory.runTurn({ sessionId: s, prompt: 'persist me' })

    const ctx2 = await boot([], { path: dir }) // fresh process, same directory
    const all = await ctx2.memory.episodic.query()
    expect(all.map((e) => e.task)).toEqual(['persist me'])
    // the new process has an empty session log, so a write must be refused rather than made up...
    await expect(ctx2.memory.episodic.record({ sessionId: s, task: 'persist me', fromSeq: 1, toSeq: r.episode.toSeq, outcome: 'done', result: 'a' })).rejects.toThrow(MemoryError)
    // ...and the file still holds exactly one line
    expect((await readFile(join(dir, 'episodic.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1)
  })

  it('a torn last line is tolerated; corruption in the middle is not', async () => {
    const dir = await tmp()
    const ctx1 = await boot([{ text: 'a' }], { path: dir })
    await ctx1.memory.runTurn({ sessionId: ctx1.log.create('s1'), prompt: 'ok' })
    await appendFile(join(dir, 'episodic.jsonl'), '{"id":"torn', 'utf8')
    expect(await (await boot([], { path: dir })).memory.episodic.query()).toHaveLength(1)
    await appendFile(join(dir, 'episodic.jsonl'), '\n{"id":"later"}\n', 'utf8')
    await expect((await boot([], { path: dir })).memory.episodic.query()).rejects.toThrow(/corrupt/)
  })

  it('summariseApproach keeps order, collapses only consecutive repeats', () => {
    const ev = (name: string, seq: number) => ({ seq, ts: '', sessionId: 's', type: 'tool.call', data: { name } })
    expect(summariseApproach([ev('a', 1), ev('a', 2), ev('b', 3), ev('a', 4)]).approach).toBe('a x2 -> b -> a')
  })
})
