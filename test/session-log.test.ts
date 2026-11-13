import { Context } from 'cordis'
import { mkdtemp, readFile, appendFile, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SessionLog } from '../src/bundles/session-log/index.js'

async function boot(config = {}) {
  const ctx = new Context()
  ctx.plugin(SessionLog, config)
  return ctx
}

describe('bundle-session-log', () => {
  it('registers as ctx.log', async () => {
    const ctx = await boot({ memory: true })
    expect(ctx.log).toBeInstanceOf(SessionLog)
  })

  it('assigns monotonic seq even under concurrent appends', async () => {
    const ctx = await boot({ memory: true })
    const s = ctx.log.create('a')
    await Promise.all(Array.from({ length: 50 }, (_, i) => ctx.log.append(s, 'x', { i })))
    const events = await ctx.log.read(s)
    expect(events.map((e) => e.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
    expect(events.map((e: any) => e.data.i)).toEqual(Array.from({ length: 50 }, (_, i) => i))
  })

  it.skipIf(process.platform === 'win32')('refuses symlinked session files for reads, appends, and torn-tail repair', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slog-symlink-'))
    const external = join(dir, '..', 'outside-session-target.txt')
    await writeFile(external, 'DO NOT MODIFY')
    await symlink(external, join(dir, 'linked.jsonl'))
    const ctx = await boot({ path: dir })
    await expect(ctx.log.read('linked')).rejects.toThrow(/regular non-symlink file/)
    await expect(ctx.log.append('linked', 'overwrite')).rejects.toThrow(/regular non-symlink file/)
    expect(await readFile(external, 'utf8')).toBe('DO NOT MODIFY')
  })

  it('persists to JSONL and resumes after a "restart"', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slog-'))
    const c1 = await boot({ path: dir })
    await c1.log.append('s1', 'model.input', { text: 'hi' })
    await c1.log.append('s1', 'model.output', { text: 'yo' })
    const c2 = await boot({ path: dir })
    expect(await c2.log.resume('s1')).toEqual({ sessionId: 's1', nextSeq: 3 })
    const e = await c2.log.append('s1', 'tool.call', { name: 'ls' })
    expect(e.seq).toBe(3)
    expect((await readFile(join(dir, 's1.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(3)
  })

  it('tolerates a torn final line but rejects mid-file corruption', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slog-'))
    const c = await boot({ path: dir })
    await c.log.append('t', 'a')
    await appendFile(join(dir, 't.jsonl'), '{"seq":2,"ty')
    expect(await c.log.read('t')).toHaveLength(1)
    await appendFile(join(dir, 't.jsonl'), '\n{"seq":3}\n')
    await expect(c.log.read('t')).rejects.toThrow(/Corrupt/)
  })



  it('refuses to append when corruption exists before a later valid JSON record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slog-middle-corrupt-'))
    const ctx = await boot({ path: dir })
    await ctx.log.append('middle', 'first')
    await appendFile(join(dir, 'middle.jsonl'), 'not-json\n{"seq":2,"ts":"2026-11-07T00:00:00.000Z","sessionId":"middle","type":"later","data":null}\n')
    await expect(ctx.log.append('middle', 'must-not-append')).rejects.toThrow(/Corrupt session log.*line 2/)
  })

  it('repairs a torn final record before appending after restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slog-repair-'))
    const first = await boot({ path: dir })
    await first.log.append('repair', 'first', { ok: true })
    await appendFile(join(dir, 'repair.jsonl'), '{"seq":2,"ty')

    const resumed = await boot({ path: dir })
    const next = await resumed.log.append('repair', 'second', { ok: true })
    expect(next.seq).toBe(2)
    const raw = await readFile(join(dir, 'repair.jsonl'), 'utf8')
    expect(raw).not.toContain('{"seq":2,"ty')
    expect(raw.split('\n').filter(Boolean).every((line) => { try { JSON.parse(line); return true } catch { return false } })).toBe(true)
    const events = await resumed.log.read('repair')
    expect(events.map((event) => event.type)).toEqual(['first', 'second'])
    expect(events.map((event) => event.seq)).toEqual([1, 2])
  })

  it('separates a complete final JSON record that lost its trailing newline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slog-no-newline-'))
    const first = await boot({ path: dir })
    await first.log.append('no-newline', 'first', { ok: true })
    const file = join(dir, 'no-newline.jsonl')
    await writeFile(file, (await readFile(file, 'utf8')).trimEnd(), 'utf8')

    const resumed = await boot({ path: dir })
    expect(await resumed.log.resume('no-newline')).toEqual({ sessionId: 'no-newline', nextSeq: 2 })
    const next = await resumed.log.append('no-newline', 'second', { ok: true })
    expect(next.seq).toBe(2)
    const raw = await readFile(file, 'utf8')
    expect(raw.split('\n').filter(Boolean)).toHaveLength(2)
    expect((await resumed.log.read('no-newline')).map((event) => event.type)).toEqual(['first', 'second'])
  })

  it('refreshes a JSONL sequence after another process context appends', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slog-stale-seq-'))
    const writer = await boot({ path: dir })
    const reader = await boot({ path: dir })
    await writer.log.append('shared', 'first')
    expect((await reader.log.resume('shared')).nextSeq).toBe(2)
    await writer.log.append('shared', 'second')
    expect((await reader.log.resume('shared')).nextSeq).toBe(3)
  })

  it('snapshots caller payloads before waiting in the append queue', async () => {
    const ctx = await boot({ memory: true })
    const payload = { nested: { value: 'original' } }
    const pending = ctx.log.append('snapshot', 'custom', payload)
    payload.nested.value = 'mutated'
    await pending
    expect((await ctx.log.read('snapshot'))[0]!.data).toEqual({ nested: { value: 'original' } })
  })

  it('forks without modifying the original', async () => {
    const ctx = await boot({ memory: true })
    for (const t of ['a', 'b', 'c']) await ctx.log.append('orig', t)
    const f = await ctx.log.fork('orig', 2, 'child')
    const child = await ctx.log.read(f)
    expect(child.map((e) => e.type)).toEqual(['session.fork', 'a', 'b'])
    expect(child[0]!.data).toEqual({ fromSession: 'orig', atSeq: 2 })
    expect(await ctx.log.read('orig')).toHaveLength(3)
    await expect(ctx.log.fork('orig', 99)).rejects.toThrow(/no seq/)
  })

  it('replays from a given seq', async () => {
    const ctx = await boot({ memory: true })
    for (const t of ['a', 'b', 'c']) await ctx.log.append('r', t)
    const got: string[] = []
    for await (const e of ctx.log.replay('r', 2)) got.push(e.type)
    expect(got).toEqual(['b', 'c'])
  })

  it('rejects path-traversal session ids and non-serialisable payloads', async () => {
    const ctx = await boot({ memory: true })
    await expect(ctx.log.append('../evil', 'x')).rejects.toThrow(/Invalid session id/)
    const cyc: any = {}
    cyc.self = cyc
    await expect(ctx.log.append('ok', 'x', cyc)).rejects.toThrow()
    // a failed append must not burn a seq
    expect((await ctx.log.append('ok', 'x', 1)).seq).toBe(1)
  })

  it('forked branches diverge independently (no cross-contamination)', async () => {
    const ctx = await boot({ memory: true })
    for (const t of ['a', 'b', 'c']) await ctx.log.append('main', t)
    await ctx.log.fork('main', 2, 'branch')
    await ctx.log.append('main', 'main-only')
    await ctx.log.append('branch', 'branch-only')
    expect((await ctx.log.read('main')).map((e) => e.type)).toEqual(['a', 'b', 'c', 'main-only'])
    expect((await ctx.log.read('branch')).map((e) => e.type)).toEqual(['session.fork', 'a', 'b', 'branch-only'])
  })

  it('is immutable through its API: no update/delete surface, and returned events are copies', async () => {
    const ctx = await boot({ memory: true })
    const proto = Object.getOwnPropertyNames(SessionLog.prototype)
    expect(proto.filter((n) => /update|delete|remove|set|truncate|clear|edit|patch/i.test(n))).toEqual([])

    const appended = await ctx.log.append('imm', 'orig', { v: 1 })
    ;(appended.data as any).v = 999
    const read1 = await ctx.log.read('imm')
    ;(read1[0]!.data as any).v = 777
    read1.pop()
    const read2 = await ctx.log.read('imm')
    expect(read2).toHaveLength(1)
    expect((read2[0]!.data as any).v).toBe(1)
  })
})

import { EgressPolicy } from '../src/bundles/egress/index.js'
import { ToolRegistry } from '../src/bundles/tool-registry/index.js'

describe('SEC-01 session-log redaction', () => {
  it('no seeded secret survives anywhere in the persisted log (tool.call, tool.result, approval.pending, custom)', async () => {
    const SECRET = 'sk-live-SEEDED-9f8e7d6c5b4a'
    const dir = await mkdtemp(join(tmpdir(), 'slog-sec-'))
    const ctx = new Context()
    await ctx.plugin(SessionLog, { path: dir })
    await ctx.plugin(EgressPolicy, { projectId: 'p', secrets: { api: SECRET } })
    await ctx.plugin(ToolRegistry)
    ctx.tools.register({
      name: 'leaky',
      description: 'echoes its input',
      actionClass: 'read-only',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      execute: async (i: any) => `read: ${i.text}`,
    } as any)
    const s = ctx.log.create('sec1')
    await ctx.tools.call('leaky', { text: `key=${SECRET}` }, { sessionId: s })
    await ctx.log.append(s, 'approval.pending', { input: { token: SECRET }, nested: [[SECRET]] })
    await ctx.log.append(s, 'custom', { when: new Date(), s: SECRET })
    const raw = await readFile(join(dir, 'sec1.jsonl'), 'utf8')
    expect(raw).not.toContain(SECRET)
    expect(raw).toContain('[redacted:api]')
    const events = await ctx.log.read(s)
    expect(events.map((e) => e.type)).toEqual(['tool.call', 'tool.result', 'approval.pending', 'custom'])
  })

  it('secrets registered after boot are honoured', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionLog, { memory: true })
    await ctx.plugin(EgressPolicy, { projectId: 'p' })
    ctx.egress.registerSecret('late', 'LATE-SECRET-123')
    await ctx.log.append('s', 't', { x: 'a LATE-SECRET-123 b' })
    expect(JSON.stringify(await ctx.log.read('s'))).not.toContain('LATE-SECRET-123')
  })
})
