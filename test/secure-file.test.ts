import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendTextFileNoFollow,
  readTextFileNoFollow,
  readTextFileSyncNoFollow,
  truncateFileNoFollow,
} from '../src/util/secure-file.js'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'secure-file-')); dirs.push(dir); return dir }

describe('persistent state no-follow helpers', () => {
  it('reads regular files and rejects a symlink as the final component', async () => {
    const dir = temp()
    const real = join(dir, 'real.json')
    const link = join(dir, 'link.json')
    writeFileSync(real, '{"safe":true}')
    expect(await readTextFileNoFollow(real)).toBe('{"safe":true}')
    expect(readTextFileSyncNoFollow(real)).toBe('{"safe":true}')
    try { symlinkSync(real, link, 'file') } catch { return }
    await expect(readTextFileNoFollow(link)).rejects.toThrow(/regular non-symlink/)
    expect(() => readTextFileSyncNoFollow(link)).toThrow(/regular non-symlink/)
  })

  it('rejects symlinked parent directories before reading or appending', async () => {
    const dir = temp()
    const realDir = join(dir, 'real')
    const linkedDir = join(dir, 'linked')
    mkdirSync(realDir)
    writeFileSync(join(realDir, 'state.json'), '{"safe":true}')
    try { symlinkSync(realDir, linkedDir, 'dir') } catch { return }
    await expect(readTextFileNoFollow(join(linkedDir, 'state.json'))).rejects.toThrow(/parent is not a real directory/)
    await expect(appendTextFileNoFollow(join(linkedDir, 'state.json'), 'unsafe')).rejects.toThrow(/parent is not a real directory/)
  })

  it('appends and truncates only a regular non-symlink file', async () => {
    const dir = temp()
    const file = join(dir, 'events.jsonl')
    writeFileSync(file, '{"seq":1}\\n')
    await appendTextFileNoFollow(file, '{"seq":2}\\n')
    expect(await readTextFileNoFollow(file)).toBe('{"seq":1}\\n{"seq":2}\\n')
    await truncateFileNoFollow(file, 10)
    expect(await readTextFileNoFollow(file)).toBe('{"seq":1}')
  })
})
