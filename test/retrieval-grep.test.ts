import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from 'cordis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Subprocess } from '../src/bundles/subprocess/index.js'
import type { RunResult } from '../src/bundles/subprocess/types.js'
import {
  parseRgJson,
  RetrievalGrep,
  RetrievalGrepConfigError,
  type RetrievalGrepConfig,
  type RetrievalGrepResult,
} from '../src/bundles/retrieval-grep/index.js'

const hasRg = spawnSync('rg', ['--version']).status === 0

function ev(path: string, text: string, line = 1): string {
  return JSON.stringify({ type: 'match', data: { path: { text: path }, lines: { text: text + '\n' }, line_number: line, absolute_offset: 0, submatches: [] } })
}

function okResults(r: RetrievalGrepResult) {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`)
  return r
}

/* ------------------------------------------------------------------ parser */

describe('parseRgJson', () => {
  const root = process.platform === 'win32' ? 'C:\\proj' : '/proj'
  const p = (rel: string) => (process.platform === 'win32' ? `C:\\proj\\${rel.replace(/\//g, '\\')}` : `/proj/${rel}`)
  const limits = { maxMatchesPerFile: 5, maxResults: 10 }

  it('reads the nested `data` shape and ignores begin/end/summary', () => {
    const out = [
      JSON.stringify({ type: 'begin', data: { path: { text: p('a.txt') } } }),
      ev(p('a.txt'), 'hello   ', 3),
      JSON.stringify({ type: 'end', data: { path: { text: p('a.txt') } } }),
      JSON.stringify({ type: 'summary', data: { stats: {} } }),
    ].join('\n')
    expect(parseRgJson(out, root, limits)).toEqual({
      results: [{ file: 'a.txt', matches: [{ line: 3, text: 'hello' }], matchCount: 1 }],
      truncated: false,
    })
  })

  it('skips bytes-encoded paths/lines, malformed lines and paths outside root', () => {
    const out = [
      JSON.stringify({ type: 'match', data: { path: { bytes: 'YQ==' }, lines: { text: 'x\n' }, line_number: 1 } }),
      JSON.stringify({ type: 'match', data: { path: { text: p('a.txt') }, lines: { bytes: 'YQ==' }, line_number: 1 } }),
      'NOT JSON',
      '{"type":"match","data":{"path":{"te', // cut mid-line
      ev(process.platform === 'win32' ? 'C:\\elsewhere\\x.txt' : '/elsewhere/x.txt', 'nope'),
      ev(p('ok.txt'), 'yes'),
    ].join('\n')
    expect(parseRgJson(out, root, limits).results.map((r) => r.file)).toEqual(['ok.txt'])
  })

  it('caps kept matches but counts all, cuts long lines, ranks by count then path, flags truncation', () => {
    const lines: string[] = []
    for (let i = 1; i <= 7; i++) lines.push(ev(p('z.txt'), 'q', i))
    // a.txt (6) sorts before z.txt (7) alphabetically and both keep 5 lines after the cap:
    // only the TRUE count can put z.txt first.
    for (let i = 1; i <= 6; i++) lines.push(ev(p('a.txt'), 'q', i))
    for (let i = 1; i <= 3; i++) lines.push(ev(p('b.txt'), i === 1 ? 'x'.repeat(1000) : 'q', i))
    for (let i = 1; i <= 3; i++) lines.push(ev(p('c.txt'), 'q', i))
    lines.push(ev(p('d.txt'), 'q'))
    const r = parseRgJson(lines.join('\n'), root, { maxMatchesPerFile: 5, maxResults: 4 })
    expect(r.results.map((x) => [x.file, x.matchCount, x.matches.length])).toEqual([
      ['z.txt', 7, 5],
      ['a.txt', 6, 5],
      ['b.txt', 3, 3],
      ['c.txt', 3, 3],
    ])
    expect(r.results[2]!.matches[0]!.text).toHaveLength(300)
    expect(r.truncated).toBe(true)
  })
})

/* ------------------------------------------------- error mapping (no rg) */

describe('RetrievalGrep with a stubbed subprocess', () => {
  const rr = (o: Partial<RunResult>): RunResult => ({
    command: 'rg', args: [], cwd: '/', exitCode: 0, signal: null, stdout: '', stderr: '',
    stdoutTruncated: false, stderrTruncated: false, timedOut: false, aborted: false, durationMs: 1, ...o,
  })
  const root = realpathSync(tmpdir())

  async function boot(canned: RunResult, seen?: { args?: string[]; opts?: unknown }) {
    const ctx = new Context()
    class Stub extends Service {
      constructor(c: Context) { super(c, 'subprocess') }
      async run(_cmd: string, args: string[], opts: unknown) { if (seen) { seen.args = args; seen.opts = opts } return canned }
    }
    await ctx.plugin(Stub)
    await ctx.plugin(RetrievalGrep, { root } satisfies RetrievalGrepConfig)
    return ctx
  }
  const kind = (r: RetrievalGrepResult) => (r.ok ? 'ok' : r.error.kind)

  it('spawnError -> rg_missing', async () => expect(kind(await (await boot(rr({ spawnError: 'ENOENT', exitCode: null }))).retrievalGrep.search('x'))).toBe('rg_missing'))
  it('timedOut -> timeout', async () => expect(kind(await (await boot(rr({ timedOut: true, exitCode: null }))).retrievalGrep.search('x'))).toBe('timeout'))
  it('exit 2 without matches -> bad_pattern', async () => expect(kind(await (await boot(rr({ exitCode: 2, stderr: 'regex parse error' }))).retrievalGrep.search('('))).toBe('bad_pattern'))
  it('exit 1 -> ok, empty', async () => {
    const r = okResults(await (await boot(rr({ exitCode: 1 }))).retrievalGrep.search('x'))
    expect(r.results).toEqual([])
  })
  it('exit 2 WITH matches (unreadable file) -> ok', async () => {
    const out = ev(join(root, 'a.txt'), 'hit')
    const r = okResults(await (await boot(rr({ exitCode: 2, stdout: out }))).retrievalGrep.search('x'))
    expect(r.results.map((x) => x.file)).toEqual(['a.txt'])
  })
  it('killed by signal -> rg_failed', async () => expect(kind(await (await boot(rr({ exitCode: null, signal: 'SIGKILL' }))).retrievalGrep.search('x'))).toBe('rg_failed'))
  it('stdoutTruncated is surfaced as truncated', async () => {
    const r = okResults(await (await boot(rr({ exitCode: 0, stdoutTruncated: true, stdout: ev(join(root, 'a.txt'), 'h') }))).retrievalGrep.search('x'))
    expect(r.truncated).toBe(true)
  })
  it('empty query and NUL byte never reach the subprocess', async () => {
    const seen: { args?: string[] } = {}
    const ctx = await boot(rr({}), seen)
    expect(kind(await ctx.retrievalGrep.search(''))).toBe('bad_pattern')
    expect(kind(await ctx.retrievalGrep.search('a\0b'))).toBe('bad_pattern')
    expect(seen.args).toBeUndefined()
  })
  it('argv: query after -e, target after --, secret globs AFTER extraArgs, timeout passed', async () => {
    const seen: { args?: string[]; opts?: any } = {}
    const ctx = new Context()
    class Stub extends Service {
      constructor(c: Context) { super(c, 'subprocess') }
      async run(_c: string, args: string[], opts: unknown) { seen.args = args; seen.opts = opts; return rr({ exitCode: 1 }) }
    }
    await ctx.plugin(Stub)
    await ctx.plugin(RetrievalGrep, { root, extraArgs: ['--glob', 'keepme'], timeoutMs: 1234 })
    await ctx.retrievalGrep.search('--files')
    const a = seen.args!
    expect(a.slice(-4)).toEqual(['-e', '--files', '--', root])
    expect(a.indexOf('!.env*')).toBeGreaterThan(a.indexOf('keepme'))
    expect(a).toContain('--no-config')
    expect(a).not.toContain('--hidden')
    expect(seen.opts.timeoutMs).toBe(1234)
  })
  it('rejects a relative root', async () => {
    const ctx = new Context()
    await ctx.plugin(Subprocess)
    await expect(ctx.plugin(RetrievalGrep, { root: 'relative/dir' })).rejects.toBeInstanceOf(RetrievalGrepConfigError)
  })
})

/* ------------------------------------------------------ real ripgrep */

describe.skipIf(!hasRg)('RetrievalGrep with real ripgrep', () => {
  let base: string
  let root: string
  let outside: string
  const Q = 'needle-42'

  async function boot(config: Partial<RetrievalGrepConfig> = {}) {
    const ctx = new Context()
    await ctx.plugin(Subprocess)
    await ctx.plugin(RetrievalGrep, { root, ...config })
    return ctx.retrievalGrep
  }
  const files = async (q: string, cfg: Partial<RetrievalGrepConfig> = {}, o = {}) => {
    const r = await (await boot(cfg)).search(q, o)
    return okResults(r).results.map((x) => x.file).sort()
  }

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'rgtest-')))
    root = join(base, 'root')
    outside = join(base, 'root-evil') // sibling whose name starts with root's name
    for (const d of ['root/src', 'root/skip', 'root/node_modules/dep', 'root/.git', 'root-evil']) mkdirSync(join(base, d), { recursive: true })
    const w = (rel: string, s: string | Buffer) => writeFileSync(join(base, rel), s)
    w('root/src/app.ts', `const a = "${Q}"\n`)
    w('root/skip/other.ts', `${Q}\n`)
    w('root/README.md', `${Q}\n${Q}\n${Q}\n`)
    w('root/.env', `${Q}\n`)
    w('root/.env.local', `${Q}\n`)
    w('root/prod.env', `${Q}\n`)
    w('root/key.pem', `${Q}\n`)
    w('root/deploy.key', `${Q}\n`)
    w('root/id_rsa', `${Q}\n`)
    w('root/node_modules/dep/index.js', `${Q}\n`)
    w('root/.git/config', `${Q}\n`)
    w('root/bin.dat', Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(Q), Buffer.from([0])]))
    w('root/Case.txt', 'MixedCase\n')
    w('root-evil/loot.txt', `${Q}\n`)
    w('outside.txt', `${Q}\n`)
    try {
      symlinkSync(join(base, 'root-evil'), join(root, 'link-dir'), 'dir')
      symlinkSync(join(base, 'outside.txt'), join(root, 'link-file.txt'))
    } catch {
      /* no symlink privilege (Windows): those tests skip themselves */
    }
  })
  afterAll(() => rmSync(base, { recursive: true, force: true }))

  it('finds matches, relative forward-slash paths, ranked by count', async () => {
    const r = okResults(await (await boot()).search(Q))
    expect(r.results.map((x) => x.file)).toEqual(['README.md', 'skip/other.ts', 'src/app.ts'])
    expect(r.results[0]!.matchCount).toBe(3)
    expect(r.results[2]!.matches[0]).toEqual({ line: 1, text: `const a = "${Q}"` })
  })

  it('no match is ok and empty', async () => expect(await files('zzz-not-there')).toEqual([]))

  it('excludes secrets, .git, node_modules and binaries by default', async () => {
    const got = await files(Q)
    for (const bad of ['.env', '.env.local', 'prod.env', 'key.pem', 'deploy.key', 'id_rsa', 'bin.dat']) expect(got).not.toContain(bad)
    expect(got.some((f) => f.startsWith('node_modules') || f.startsWith('.git'))).toBe(false)
    expect(got).toContain('README.md') // positive control
  })

  it('includeSecrets searches secrets and hidden files but still never .git / node_modules', async () => {
    const got = await files(Q, { includeSecrets: true })
    for (const good of ['.env', '.env.local', 'prod.env', 'key.pem', 'deploy.key', 'id_rsa']) expect(got).toContain(good)
    expect(got.some((f) => f.startsWith('node_modules') || f.startsWith('.git'))).toBe(false)
  })

  it('extraArgs cannot re-include secrets', async () => {
    const got = await files(Q, { extraArgs: ['--glob', '.env', '--glob', '*.pem'] })
    expect(got).not.toContain('.env')
    expect(got).not.toContain('key.pem')
  })

  it('extraArgs ignore globs work (positive control)', async () => {
    const got = await files(Q, { extraArgs: ['--glob', '!skip/**'] })
    expect(got).not.toContain('skip/other.ts')
    expect(got).toContain('src/app.ts')
  })

  it('a query that looks like a flag is a literal pattern', async () => {
    writeFileSync(join(root, 'flags.txt'), '--files and -x\n')
    expect(await files('--files')).toEqual(['flags.txt'])
    expect(await files('-x', {}, { fixedStrings: true })).toEqual(['flags.txt'])
  })

  it('path scoping works inside root, relative to root', async () => {
    expect(await files(Q, {}, { path: 'src' })).toEqual(['src/app.ts'])
  })

  it('refuses ../, absolute outside, and the same-prefix sibling', async () => {
    const g = await boot()
    for (const path of ['..', '../root-evil', outside, base]) {
      const r = await g.search(Q, { path })
      expect(r.ok ? 'ok' : r.error.kind, path).toBe('outside_root')
    }
  })

  it('refuses a path that is a symlink to outside root', async () => {
    const g = await boot()
    let linked = true
    try { realpathSync(join(root, 'link-dir')) } catch { linked = false }
    if (!linked) return
    const r = await g.search(Q, { path: 'link-dir' })
    expect(r.ok ? 'ok' : r.error.kind).toBe('outside_root')
  })

  it('never returns content reached through symlinks inside root', async () => {
    const got = await files(Q)
    expect(got).not.toContain('link-file.txt')
    expect(got.some((f) => f.startsWith('link-dir'))).toBe(false)
    expect(got).toContain('README.md')
  })

  it('missing path -> path_not_found', async () => {
    const r = await (await boot()).search(Q, { path: 'nope' })
    expect(r.ok ? 'ok' : r.error.kind).toBe('path_not_found')
  })

  it('real bad_pattern and real rg_missing', async () => {
    const bad = await (await boot()).search('(')
    expect(bad.ok ? 'ok' : bad.error.kind).toBe('bad_pattern')
    const missing = await (await boot({ rgPath: 'definitely-not-rg-xyz' })).search(Q)
    expect(missing.ok ? 'ok' : missing.error.kind).toBe('rg_missing')
  })

  it('smart-case by default, exact with caseSensitive', async () => {
    expect(await files('mixedcase')).toEqual(['Case.txt'])
    expect(await files('mixedcase', {}, { caseSensitive: true })).toEqual([])
    expect(await files('MixedCase', {}, { caseSensitive: true })).toEqual(['Case.txt'])
  })

  it('maxResults and maxMatchesPerFile are honoured; truncated is reported', async () => {
    const g = await boot({ maxResults: 1, maxMatchesPerFile: 2 })
    const r = okResults(await g.search(Q))
    expect(r.results).toHaveLength(1)
    expect(r.results[0]!.matches).toHaveLength(2)
    expect(r.results[0]!.matchCount).toBe(3)
    expect(r.truncated).toBe(true)
  })
})

/* ------------------------------------------------------------ listFiles */

describe('RetrievalGrep.listFiles', () => {
  const stubRun = (canned: Partial<RunResult>) => {
    const ctx = new Context()
    class Stub extends Service {
      constructor(c: Context) { super(c, 'subprocess') }
      async run() {
        return { command: 'rg', args: [], cwd: '/', exitCode: 0, signal: null, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false, timedOut: false, aborted: false, durationMs: 1, ...canned } as RunResult
      }
    }
    return { ctx, Stub }
  }
  const tmpRoot = realpathSync(tmpdir())
  const k = (r: { ok: boolean; error?: { kind: string } }) => (r.ok ? 'ok' : r.error!.kind)

  it('maps failures without needing rg (stubbed subprocess)', async () => {
    for (const [canned, want] of [
      [{ spawnError: 'ENOENT', exitCode: null }, 'rg_missing'],
      [{ timedOut: true, exitCode: null }, 'timeout'],
      [{ exitCode: 2, stderr: 'boom' }, 'rg_failed'],
      [{ exitCode: null, signal: 'SIGKILL' as const }, 'rg_failed'],
    ] as const) {
      const { ctx, Stub } = stubRun(canned)
      await ctx.plugin(Stub)
      await ctx.plugin(RetrievalGrep, { root: tmpRoot })
      expect(k(await ctx.retrievalGrep.listFiles()), JSON.stringify(canned)).toBe(want)
    }
  })

  it('splits on NUL (a newline in a file name is part of the name), sorts, drops paths outside root, flags capture truncation', async () => {
    const out = [join(tmpRoot, 'b.txt'), join(tmpRoot, 'a\nb.txt'), join(tmpRoot, '..', 'outside.txt'), join(tmpRoot, 'sub', 'c.txt')].join('\0') + '\0'
    const { ctx, Stub } = stubRun({ stdout: out, stdoutTruncated: true })
    await ctx.plugin(Stub)
    await ctx.plugin(RetrievalGrep, { root: tmpRoot })
    const r = await ctx.retrievalGrep.listFiles()
    expect(r.ok && r.files).toEqual(['a\nb.txt', 'b.txt', 'sub/c.txt'])
    expect(r.ok && r.truncated).toBe(true)
  })

  it('exit 1 (nothing to list) is ok and empty', async () => {
    const { ctx, Stub } = stubRun({ exitCode: 1 })
    await ctx.plugin(Stub)
    await ctx.plugin(RetrievalGrep, { root: tmpRoot })
    const r = await ctx.retrievalGrep.listFiles()
    expect(r.ok && r.files).toEqual([])
  })

  describe.skipIf(!hasRg)('with real ripgrep', () => {
    let base: string
    let root: string
    beforeAll(() => {
      base = realpathSync(mkdtempSync(join(tmpdir(), 'rglist-')))
      root = join(base, 'root')
      for (const d of ['root/src/deep', 'root/skip', 'root/node_modules/dep', 'root/.git', 'root-evil']) mkdirSync(join(base, d), { recursive: true })
      const w = (rel: string, s: string) => writeFileSync(join(base, rel), s)
      for (const f of ['root/z.txt', 'root/a.txt', 'root/src/app.ts', 'root/src/deep/x.ts', 'root/skip/s.ts', 'root/.env', 'root/.env.local', 'root/prod.env', 'root/key.pem', 'root/deploy.key', 'root/id_rsa', 'root/node_modules/dep/i.js', 'root/.git/config', 'root/.hidden.txt', 'root-evil/loot.txt']) w(f, 'x\n')
      try { symlinkSync(join(base, 'root-evil'), join(root, 'link-dir'), 'dir') } catch { /* no symlink privilege */ }
    })
    afterAll(() => rmSync(base, { recursive: true, force: true }))
    const list = async (cfg: Partial<import('../src/bundles/retrieval-grep/index.js').RetrievalGrepConfig> = {}, opts = {}) => {
      const ctx = new Context()
      await ctx.plugin(Subprocess)
      await ctx.plugin(RetrievalGrep, { root, ...cfg })
      return ctx.retrievalGrep.listFiles(opts)
    }

    it('lists sorted, root-relative, forward-slash paths; no secrets, .git, node_modules, hidden files or symlinked dirs', async () => {
      const r = await list()
      expect(r.ok && r.files).toEqual(['a.txt', 'skip/s.ts', 'src/app.ts', 'src/deep/x.ts', 'z.txt'])
      expect(r.ok && r.truncated).toBe(false)
    })

    it('includeSecrets adds hidden and secret files but never .git or node_modules', async () => {
      const r = await list({ includeSecrets: true })
      expect(r.ok && r.files).toEqual(['.env', '.env.local', '.hidden.txt', 'a.txt', 'deploy.key', 'id_rsa', 'key.pem', 'prod.env', 'skip/s.ts', 'src/app.ts', 'src/deep/x.ts', 'z.txt'])
    })

    it('extraArgs can narrow the list but cannot re-include secrets', async () => {
      const narrowed = await list({ extraArgs: ['--glob', '!skip/**'] })
      expect(narrowed.ok && narrowed.files).not.toContain('skip/s.ts')
      expect(narrowed.ok && narrowed.files).toContain('src/app.ts')
      const tried = await list({ extraArgs: ['--glob', '.env', '--glob', '*.pem', '--glob', 'id_rsa'] })
      expect(tried.ok && tried.files.some((f) => f.startsWith('.env') || f.endsWith('.pem') || f === 'id_rsa')).toBe(false)
    })

    it('is scoped by path, and path escapes are refused exactly as for search', async () => {
      expect((await list({}, { path: 'src' })).ok && ((await list({}, { path: 'src' })) as { files: string[] }).files).toEqual(['src/app.ts', 'src/deep/x.ts'])
      for (const path of ['..', '../root-evil', base]) expect(k(await list({}, { path })), path).toBe('outside_root')
      expect(k(await list({}, { path: 'nope' }))).toBe('path_not_found')
    })

    it('maxFiles caps the list and says so', async () => {
      const r = await list({ maxFiles: 2 })
      expect(r.ok && r.files).toEqual(['a.txt', 'skip/s.ts'])
      expect(r.ok && r.truncated).toBe(true)
    })
  })
})
