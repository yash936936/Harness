/** BUG-03/04/05: filesystem races in the local tools. */
import { Context } from 'cordis'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { ToolRegistry } from '../src/bundles/tool-registry/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { Sandbox } from '../src/bundles/sandbox/index.js'
import { LocalTools } from '../src/bundles/tools-local/index.js'
import { FileTooLarge, readBounded } from '../src/bundles/tools-local/bounded-read.js'
import { assertSameDir, dirIdentity, PathRefused } from '../src/bundles/tools-local/paths.js'

const dirs: string[] = []
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'races-'))); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

async function boot(root: string, extra: Record<string, unknown> = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(EgressPolicy, { projectId: 'tools-local-races' })
  await ctx.plugin(Sandbox)
  await ctx.plugin(LocalTools, { root, ...extra })
  return ctx
}

describe('BUG-03: write_file never replaces an existing file, even under concurrency', () => {
  it('25 concurrent creators: exactly one wins, the file holds exactly the winner\'s content, no temp files left', async () => {
    const root = tmp()
    const ctx = await boot(root)
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => ctx.tools.call('write_file', { path: 'race.txt', content: `writer-${i}` }, { sessionId: 's' })),
    )
    const ok = results.map((r, i) => (r.ok ? i : -1)).filter((i) => i >= 0)
    expect(ok).toHaveLength(1)
    expect(readFileSync(join(root, 'race.txt'), 'utf8')).toBe(`writer-${ok[0]}`)
    for (const r of results) if (!r.ok) expect(r.content).toMatch(/already exists/)
    expect(readdirSync(root)).toEqual(['race.txt'])
  })

  it('an existing file is never replaced', async () => {
    const root = tmp(); writeFileSync(join(root, 'keep.txt'), 'original')
    const ctx = await boot(root)
    expect((await ctx.tools.call('write_file', { path: 'keep.txt', content: 'new' }, { sessionId: 's' })).ok).toBe(false)
    expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('original')
  })
})

describe('BUG-04: the byte limit holds while reading', () => {
  it('readBounded stops at limit+1 even when the source keeps producing data', async () => {
    let served = 0
    const endless = { read: async (b: Uint8Array, off: number, len: number) => { b.fill(97, off, off + len); served += len; return { bytesRead: len } } }
    await expect(readBounded(endless, 1000)).rejects.toBeInstanceOf(FileTooLarge)
    expect(served).toBeLessThanOrEqual(1001)
  })
  it('a file exactly at the limit is fine, one byte over is refused', async () => {
    const root = tmp(); writeFileSync(join(root, 'at.txt'), 'a'.repeat(100)); writeFileSync(join(root, 'over.txt'), 'a'.repeat(101))
    const ctx = await boot(root, { maxFileBytes: 100 })
    expect((await ctx.tools.call('read_file', { path: 'at.txt' }, { sessionId: 's' })).ok).toBe(true)
    const r = await ctx.tools.call('read_file', { path: 'over.txt' }, { sessionId: 's' })
    expect(r.ok).toBe(false); expect(r.content).toMatch(/over the 100-byte limit/)
  })
})

describe.skipIf(process.platform === 'win32')('BUG-05: a directory swapped for a symlink after validation is caught', () => {
  it('assertSameDir refuses once the directory has been replaced by a link to the outside', () => {
    const root = tmp(); const outside = tmp()
    mkdirSync(join(root, 'sub'))
    const id = dirIdentity(join(root, 'sub'))
    assertSameDir(root, join(root, 'sub'), id) // unchanged: fine
    rmSync(join(root, 'sub'), { recursive: true }); symlinkSync(outside, join(root, 'sub'))
    expect(() => assertSameDir(root, join(root, 'sub'), id)).toThrow(PathRefused)
  })
  it('a swapped-in link to a file outside the project is not read', async () => {
    const root = tmp(); const outside = tmp()
    writeFileSync(join(outside, 'secret.txt'), 'TOP-SECRET')
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'))
    const ctx = await boot(root)
    const r = await ctx.tools.call('read_file', { path: 'link.txt' }, { sessionId: 's' })
    expect(r.ok).toBe(false)
    expect(String(r.content)).not.toContain('TOP-SECRET')
  })
})
