/** SEC-04: read-only git commands must not run helpers named by a hostile repository's config. */
import { Context } from 'cordis'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { ToolRegistry } from '../src/bundles/tool-registry/index.js'
import { Subprocess } from '../src/bundles/subprocess/index.js'
import { LocalTools, hardenGit, repoFilterDrivers } from '../src/bundles/tools-local/index.js'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return process.platform !== 'win32' } catch { return false } })()
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })

/** A repo whose own config tries to run `touch <marker>` through each helper git supports. */
function hostileRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'harness-git-')))
  dirs.push(root)
  const m = (n: string) => join(root, '..', `${root.split('/').pop()}-${n}.marker`)
  const markers = { fsmonitor: m('fsmonitor'), clean: m('clean'), ext: m('ext'), textconv: m('textconv') }
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'a@b.c'); git(root, 'config', 'user.name', 'x')
  writeFileSync(join(root, 'a.txt'), 'one\n')
  writeFileSync(join(root, '.gitattributes'), 'a.txt filter=evil diff=evil\n')
  git(root, 'add', '.'); git(root, 'commit', '-q', '-m', 'init')
  writeFileSync(join(root, 'a.txt'), 'two\n') // so diff/status have something to inspect
  git(root, 'config', 'core.fsmonitor', `touch ${markers.fsmonitor}; false`)
  git(root, 'config', 'filter.evil.clean', `sh -c 'touch ${markers.clean}; cat'`)
  git(root, 'config', 'diff.external', `sh -c 'touch ${markers.ext}' --`)
  git(root, 'config', 'diff.evil.textconv', `sh -c 'touch ${markers.textconv}; cat' --`)
  return { root, markers }
}
const fired = (mk: Record<string, string>) => Object.entries(mk).filter(([, p]) => existsSync(p)).map(([k]) => k)
const clearMarkers = (mk: Record<string, string>) => Object.values(mk).forEach((p) => rmSync(p, { force: true }))

async function boot(root: string) {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(Subprocess)
  await ctx.plugin(LocalTools, { root, envAllowlist: ['PATH'] })
  return (args: string[]) => ctx.tools.call('run_command', { command: 'git', args }, { sessionId: 's' })
}

describe.skipIf(!hasGit)('SEC-04 hostile repository config', () => {
  it('control: unhardened git really does run the planted helpers (so the tests below mean something)', () => {
    const { root, markers } = hostileRepo()
    git(root, 'status'); git(root, 'diff')
    expect(fired(markers)).toContain('fsmonitor')
    expect(fired(markers)).toContain('clean')
  })

  it.each([['status'], ['diff'], ['log', '-p'], ['show']])('git %s through run_command executes none of them', async (...args) => {
    const { root, markers } = hostileRepo()
    clearMarkers(markers)
    const run = await boot(root)
    const r = await run(args)
    expect(r.ok).toBe(true)
    expect(fired(markers)).toEqual([])
  })

  it('still returns useful output (status lists the modified file; diff shows the change)', async () => {
    const { root } = hostileRepo()
    const run = await boot(root)
    expect((await run(['status', '--short'])).content).toContain('a.txt')
    expect((await run(['diff'])).content).toMatch(/-one[\s\S]*\+two/)
  })

  it('a filter defined in an included file is blanked too', async () => {
    const { root, markers } = hostileRepo()
    clearMarkers(markers)
    writeFileSync(join(root, 'extra.cfg'), `[filter "evil"]\n\tclean = sh -c 'touch ${markers.clean}; cat'\n`)
    git(root, 'config', '--unset', 'filter.evil.clean')
    git(root, 'config', 'include.path', join(root, 'extra.cfg'))
    const run = await boot(root)
    await run(['status'])
    expect(fired(markers)).toEqual([])
  })
})

describe('hardenGit (pure)', () => {
  it('leaves non-read-only and non-git-read commands alone', () => {
    expect(hardenGit(['commit', '-m', 'x'])).toBeUndefined()
    expect(hardenGit([])).toBeUndefined()
    expect(hardenGit(['push'])).toBeUndefined()
  })
  it('puts overrides before the subcommand and diff switches right after it', () => {
    const h = hardenGit(['diff', '--stat', '--', 'a.txt'])!
    const i = h.args.indexOf('diff')
    expect(h.args.slice(i, i + 3)).toEqual(['diff', '--no-ext-diff', '--no-textconv'])
    expect(h.args.slice(0, i).filter((x) => x !== '-c').some((o) => o.startsWith('core.fsmonitor=false'))).toBe(true)
    expect(h.args.slice(i + 3)).toEqual(['--stat', '--', 'a.txt'])
    expect(hardenGit(['status'])!.args).not.toContain('--no-ext-diff')
  })
  it('extracts only repo-scoped filter drivers; falls back to all drivers without scope info', () => {
    const z = 'global\0filter.lfs.clean\ngit-lfs clean\0local\0filter.evil.clean\nx\0local\0filter.a.b.smudge\ny\0local\0user.name\nz\0'
    expect(repoFilterDrivers(z, true).sort()).toEqual(['a.b', 'evil'])
    expect(repoFilterDrivers('filter.lfs.clean\nx\0filter.evil.process\ny\0', false).sort()).toEqual(['evil', 'lfs'])
  })
})
