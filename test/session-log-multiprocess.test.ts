/** BUG-07: several PROCESSES appending to one session keep sequence numbers unique and gapless. BUG-09 uses the same lock. */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LockTimeoutError, withFileLock } from '../src/util/filelock.js'
import { JsonlStore } from '../src/bundles/session-log/index.js'

const dirs: string[] = []
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'mp-'))); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const WORKER = join(__dirname, 'fixtures', 'append-worker.ts')

function worker(dir: string, sid: string, count: number, tag: string, mode = ''): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--import', 'tsx', WORKER, dir, sid, String(count), tag, mode], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('exit', (code) => (code === 0 ? resolve(0) : reject(new Error(`worker ${tag} exited ${code}: ${err.slice(0, 400)}`))))
  })
}
const seqsOf = (dir: string, sid: string) => readFileSync(join(dir, `${sid}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l).seq as number)

describe('BUG-07: concurrent processes on one session log', () => {
  it('control: WITHOUT the cross-process lock, processes produce duplicate sequence numbers (so the next test means something)', async () => {
    const dir = tmp()
    await Promise.all(['a', 'b', 'c'].map((t) => worker(dir, 's', 40, t, 'nolock')))
    const seqs = seqsOf(dir, 's')
    expect(new Set(seqs).size).toBeLessThan(seqs.length) // duplicates: the bug
  }, 60_000)

  it('WITH the lock: 4 processes x 40 appends give exactly 1..160, no duplicates, no gaps, every line valid JSON, file order = seq order', async () => {
    const dir = tmp()
    await Promise.all(['a', 'b', 'c', 'd'].map((t) => worker(dir, 's', 40, t)))
    const seqs = seqsOf(dir, 's')
    expect(seqs).toEqual(Array.from({ length: 160 }, (_, i) => i + 1))
    expect(existsSync(join(dir, 's.jsonl.lock'))).toBe(false) // nothing left behind
  }, 60_000)

  it('lastSeq reads the tail correctly, including a very long final event and a torn last line', async () => {
    const dir = tmp()
    const store = new JsonlStore(dir)
    expect(await store.lastSeq('x')).toBe(0)
    await store.append({ seq: 1, ts: 't', sessionId: 'x', type: 'a', data: null })
    await store.append({ seq: 2, ts: 't', sessionId: 'x', type: 'big', data: 'y'.repeat(300_000) })
    expect(await store.lastSeq('x')).toBe(2)
    writeFileSync(join(dir, 'x.jsonl'), readFileSync(join(dir, 'x.jsonl'), 'utf8') + '{"seq":3,"ts":"t","sess') // crash mid-write
    expect(await store.lastSeq('x')).toBe(2)
  })
})

describe('file lock', () => {
  it('excludes: two holders never overlap', async () => {
    const dir = tmp(); const lock = join(dir, 'l.lock')
    let inside = 0, peak = 0
    await Promise.all(Array.from({ length: 12 }, () => withFileLock(lock, async () => { inside++; peak = Math.max(peak, inside); await new Promise((r) => setTimeout(r, 10)); inside-- })))
    expect(peak).toBe(1)
  })
  it('releases when the work throws', async () => {
    const dir = tmp(); const lock = join(dir, 'l.lock')
    await expect(withFileLock(lock, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(existsSync(lock)).toBe(false)
    await expect(withFileLock(lock, async () => 'ok')).resolves.toBe('ok')
  })
  it('a lock left by a dead process is broken, not waited on forever', async () => {
    const dir = tmp(); const lock = join(dir, 'l.lock')
    writeFileSync(lock, JSON.stringify({ pid: 2_147_483_000, token: 'dead', ts: Date.now() }))
    await expect(withFileLock(lock, async () => 'got it', { timeoutMs: 2000 })).resolves.toBe('got it')
  })
  it('a lock held by a LIVE process times out loudly instead of proceeding unlocked', async () => {
    const dir = tmp(); const lock = join(dir, 'l.lock')
    writeFileSync(lock, JSON.stringify({ pid: process.pid, token: 'mine', ts: Date.now() }))
    await expect(withFileLock(lock, async () => 'x', { timeoutMs: 150, retryMs: 10 })).rejects.toBeInstanceOf(LockTimeoutError)
    expect(existsSync(lock)).toBe(true) // untouched: it was not ours
  })
  it('a live-but-ancient lock is treated as abandoned', async () => {
    const dir = tmp(); const lock = join(dir, 'l.lock')
    writeFileSync(lock, JSON.stringify({ pid: process.pid, token: 'old', ts: 0 }))
    await new Promise((r) => setTimeout(r, 60))
    await expect(withFileLock(lock, async () => 'ok', { staleMs: 30, timeoutMs: 1000 })).resolves.toBe('ok')
  })
})

describe('BUG-09: memory stores under several processes', () => {
  const MW = join(__dirname, 'fixtures', 'memory-worker.ts')
  const run = (dir: string, tag: string, n: number, mode = '') =>
    new Promise<void>((resolve, reject) => {
      const p = spawn(process.execPath, ['--import', 'tsx', MW, dir, tag, String(n), mode], { stdio: ['ignore', 'ignore', 'pipe'] })
      let err = ''; p.stderr.on('data', (d) => (err += d))
      p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`memory worker ${tag} exited ${c}: ${err.slice(0, 500)}`))))
    })
  const hotIds = (dir: string) => (JSON.parse(readFileSync(join(dir, 'hot.json'), 'utf8')) as Array<{ id: string }>).map((e) => e.id)

  it('control: without the lock, concurrent processes LOSE hot-tier updates', async () => {
    const dir = tmp()
    await Promise.all(['a', 'b', 'c'].map((t) => run(dir, t, 25, 'nolock').catch(() => undefined)))
    expect(hotIds(dir).length).toBeLessThan(75)
  }, 60_000)

  it('WITH the lock: 4 processes x 20 adds keep every hot entry and every episode, no duplicates', async () => {
    const dir = tmp()
    await Promise.all(['a', 'b', 'c', 'd'].map((t) => run(dir, t, 20)))
    const ids = hotIds(dir)
    expect(new Set(ids).size).toBe(80)
    expect(ids.length).toBe(80)
    const eps = readFileSync(join(dir, 'episodic.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).id)
    expect(new Set(eps).size).toBe(80)
    expect(eps.length).toBe(80)
    expect(existsSync(join(dir, 'hot.json.lock')) || existsSync(join(dir, 'episodic.jsonl.lock'))).toBe(false)
  }, 60_000)

  it('the same turn added by two processes at once is stored once', async () => {
    const dir = tmp()
    await Promise.all(['same', 'same'].map(() => run(dir, 'same', 15))) // identical ids from both processes
    const eps = readFileSync(join(dir, 'episodic.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).id)
    expect(eps.length).toBe(new Set(eps).size)
    expect(eps.length).toBe(15)
  }, 60_000)
})
