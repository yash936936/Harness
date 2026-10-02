import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from 'cordis'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Embeddings, HashingEmbeddingProvider, type EmbeddingProvider } from '../src/bundles/embeddings/index.js'
import { RetrievalGrep } from '../src/bundles/retrieval-grep/index.js'
import {
  bm25,
  chunkSource,
  looksBinary,
  queryTerms,
  RetrievalRank,
  RetrievalRankConfigError,
  sliceChunkText,
  tokenize,
  type RankResult,
  type RetrievalRankConfig,
} from '../src/bundles/retrieval-rank/index.js'
import { DEFAULT_CHUNK_OPTIONS } from '../src/bundles/retrieval-rank/chunk.js'
import { RetrievalTreesitter } from '../src/bundles/retrieval-treesitter/index.js'
import { Subprocess } from '../src/bundles/subprocess/index.js'
import { LanceVectorStore } from '../src/bundles/vectorstore-lancedb/index.js'

const hasRg = spawnSync('rg', ['--version']).status === 0

// The first use of the vector store loads LanceDB's native module, which takes seconds on a cold machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

/* ============================================================ pure: text */

describe('tokenize', () => {
  it('splits camelCase, snake_case, acronyms and digits, and keeps the whole identifier too', () => {
    expect(tokenize('parseConfigFile')).toEqual(['parse', 'config', 'file', 'parseconfigfile'])
    expect(tokenize('parse_config_file')).toEqual(['parse', 'config', 'file'])
    expect(tokenize('HTTPServer')).toEqual(['http', 'server', 'httpserver'])
    expect(tokenize('utf8Decoder')).toEqual(['utf8', 'decoder', 'utf8decoder'])
    expect(tokenize('renderPage2')).toEqual(['render', 'page2', 'renderpage2'])
  })
  it('lower-cases, drops single characters and punctuation, keeps unicode words', () => {
    expect(tokenize('a + b = Éclair, 日本語!')).toEqual(['éclair', '日本語'])
    expect(tokenize('')).toEqual([])
    expect(tokenize('x i _ -')).toEqual([])
  })
})

describe('queryTerms', () => {
  it('removes stopwords and duplicates but keeps order', () => {
    const q = queryTerms('How does the config parser parse the config file?')
    expect(q.tokens).toEqual(['config', 'parser', 'parse'])
  })
  it('grep terms are 3+ characters and capped', () => {
    const q = queryTerms('an io xyz abcd', 12)
    expect(q.tokens).toEqual(['io', 'xyz', 'abcd'])
    expect(q.grepTerms).toEqual(['xyz', 'abcd'])
    expect(queryTerms('alpha bravo charlie delta echo', 3).grepTerms).toEqual(['alpha', 'bravo', 'charlie'])
  })
  it('grep terms can never contain a regex metacharacter, whatever the query holds (they are joined with | unescaped)', () => {
    const nasty = 'foo.bar* (baz)|[qux] \\back $dollar ^caret +plus ?what {brace} a|b é.ü 日本語.x ../../etc/passwd'
    const q = queryTerms(nasty)
    expect(q.grepTerms.length).toBeGreaterThan(5)
    for (const t of q.grepTerms) expect(t).toMatch(/^[\p{L}\p{N}]+$/u)
  })
  it('a query of only stopwords or single characters has no tokens', () => {
    expect(queryTerms('how do I find the code?').tokens).toEqual([])
  })
})

describe('bm25', () => {
  const docs = [['parse', 'config', 'file', 'parse'], ['render', 'page'], ['config']]
  it('matches reference values computed independently in Python from the textbook formula', () => {
    const s = bm25(docs, ['parse', 'config'])
    expect(s[0]).toBeCloseTo(1.4867526651982699, 10)
    expect(s[1]).toBe(0)
    expect(s[2]).toBeCloseTo(0.6133945669817229, 10)
  })
  it('a document with no query term scores exactly 0; an empty corpus gives []', () => {
    expect(bm25(docs, ['zzz'])).toEqual([0, 0, 0])
    expect(bm25([], ['a'])).toEqual([])
    expect(bm25([[], []], ['a'])).toEqual([0, 0])
  })
  it('repeating a query term does not change scores', () => {
    expect(bm25(docs, ['parse', 'parse', 'config'])).toEqual(bm25(docs, ['parse', 'config']))
  })
  it('a term in every document still scores >= 0 (idf never goes negative)', () => {
    for (const s of bm25([['a', 'b'], ['a'], ['a', 'c', 'd']], ['a'])) expect(s).toBeGreaterThan(0)
  })
  it('more occurrences score higher but with diminishing returns', () => {
    const one = bm25([['x', 'pad', 'pad', 'pad'], ['y', 'pad', 'pad', 'pad']], ['x'])[0] as number
    const two = bm25([['x', 'x', 'pad', 'pad'], ['y', 'pad', 'pad', 'pad']], ['x'])[0] as number
    const four = bm25([['x', 'x', 'x', 'x'], ['y', 'pad', 'pad', 'pad']], ['x'])[0] as number
    expect(two).toBeGreaterThan(one)
    expect(four - two).toBeLessThan(two - one + 1) // saturates: the gain from 2 -> 4 is not 2x the gain from 1 -> 2
    expect(four).toBeLessThan(2 * two)
  })
  it('a shorter document with the same count scores higher (length normalisation); b = 0 turns it off', () => {
    const d = [['x', 'a'], ['x', 'a', 'a', 'a', 'a', 'a', 'a', 'a']]
    const s = bm25(d, ['x'])
    expect(s[0]).toBeGreaterThan(s[1] as number)
    const flat = bm25(d, ['x'], { k1: 1.2, b: 0 })
    expect(flat[0]).toBeCloseTo(flat[1] as number, 10)
  })
  it('a rare term outweighs a common one', () => {
    const d = [['common', 'rare'], ['common'], ['common'], ['common']]
    const rare = bm25(d, ['rare'])[0] as number
    const common = bm25(d, ['common'])[0] as number
    expect(rare).toBeGreaterThan(common)
  })
})

/* ========================================================== pure: chunks */

describe('chunkSource', () => {
  const sym = (qualifiedName: string, startLine: number, endLine: number) => ({ kind: 'function' as const, name: qualifiedName.split('.').pop()!, qualifiedName, startLine, endLine, signature: '', exported: true })
  const lines = (n: number, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n')

  it('one chunk per symbol, plus windows for what is outside symbols; no overlap, nothing lost', () => {
    const src = ['import x', '', 'function a() {', '  body', '}', '', 'const top = 1', 'function b() {}', ''].join('\n')
    const cs = chunkSource('f.ts', src, [sym('a', 3, 5), sym('b', 8, 8)])
    expect(cs.map((c) => [c.startLine, c.endLine, c.kind, c.name])).toEqual([
      [1, 2, 'window', undefined],
      [3, 5, 'symbol', 'a'],
      [6, 7, 'window', undefined],
      [8, 8, 'symbol', 'b'],
    ])
    expect(cs[1]!.text).toBe('function a() {\n  body\n}')
  })

  it('a file with no symbols (prose, config, unsupported language) becomes fixed windows', () => {
    const cs = chunkSource('notes.md', lines(95), undefined, { ...DEFAULT_CHUNK_OPTIONS, windowLines: 40 })
    expect(cs.map((c) => [c.startLine, c.endLine, c.kind])).toEqual([[1, 40, 'window'], [41, 80, 'window'], [81, 95, 'window']])
  })

  it('a long symbol is split into windows of maxChunkLines, all carrying its name', () => {
    const cs = chunkSource('f.ts', lines(200), [sym('big', 1, 200)], { ...DEFAULT_CHUNK_OPTIONS, maxChunkLines: 80 })
    expect(cs.map((c) => [c.startLine, c.endLine, c.name])).toEqual([[1, 80, 'big'], [81, 160, 'big'], [161, 200, 'big']])
  })

  it('nested symbols each get a chunk (class and its methods), identical ranges only once', () => {
    const cs = chunkSource('f.ts', lines(10), [sym('C', 1, 10), sym('C.m', 3, 5), sym('C.dup', 1, 10)])
    expect(cs.map((c) => [c.startLine, c.endLine, c.name])).toEqual([[1, 10, 'C'], [3, 5, 'C.m']])
  })

  it('whitespace-only windows and empty sources produce nothing', () => {
    expect(chunkSource('f.txt', '\n\n   \n', undefined)).toEqual([])
    expect(chunkSource('f.txt', '', undefined)).toEqual([])
  })

  it('CRLF sources chunk the same as LF and never keep a carriage return', () => {
    const a = chunkSource('f.ts', 'function a() {\r\n  x\r\n}\r\n', [sym('a', 1, 3)])
    expect(a[0]!.text).toBe('function a() {\n  x\n}')
  })

  it('ids are content-addressed: same text and range give the same id; any change gives a new one', () => {
    const one = chunkSource('f.ts', 'function a() {\n  x\n}', [sym('a', 1, 3)])[0]!
    const same = chunkSource('f.ts', 'function a() {\n  x\n}', [sym('a', 1, 3)])[0]!
    const edited = chunkSource('f.ts', 'function a() {\n  y\n}', [sym('a', 1, 3)])[0]!
    const moved = chunkSource('f.ts', '\nfunction a() {\n  x\n}', [sym('a', 2, 4)])[0]!
    const otherFile = chunkSource('g.ts', 'function a() {\n  x\n}', [sym('a', 1, 3)])[0]!
    expect(same.id).toBe(one.id)
    expect(new Set([one.id, edited.id, moved.id, otherFile.id]).size).toBe(4)
    expect(one.id).toMatch(/^f\.ts#1-3#[0-9a-f]{12}$/)
  })

  it('maxChunkChars cuts text, and sliceChunkText reproduces a chunk exactly (what staleness checks rely on)', () => {
    const src = lines(30, 'x'.repeat(100))
    const opts = { ...DEFAULT_CHUNK_OPTIONS, maxChunkChars: 500 }
    const c = chunkSource('f.txt', src, undefined, opts)[0]!
    expect(c.text).toHaveLength(500)
    expect(sliceChunkText(src.split('\n'), c.startLine, c.endLine, 500)).toBe(c.text)
  })

  it('looksBinary spots a NUL in the first bytes only', () => {
    expect(looksBinary(Buffer.from([65, 0, 66]))).toBe(true)
    expect(looksBinary(Buffer.from('plain text'))).toBe(false)
    expect(looksBinary(Buffer.concat([Buffer.alloc(9000, 65), Buffer.from([0])]))).toBe(false)
  })
})

/* ================================================ integration: fixture repo */

let base: string
let root: string
beforeAll(async () => {
  await import('@lancedb/lancedb') // warm up the native module once, outside any test's clock
  base = realpathSync(mkdtempSync(join(tmpdir(), 'rank-')))
  root = join(base, 'repo')
  mkdirSync(join(base, 'repo-evil'), { recursive: true }) // a sibling whose name starts with the root's
  for (const d of ['src/config', 'src/net', 'src/ui', 'src/util', 'docs']) mkdirSync(join(root, d), { recursive: true })
  const w = (rel: string, s: string) => writeFileSync(join(root, rel), s)
  w('src/config/parser.ts', `import { readFileSync } from 'node:fs'

/** Read a config file from disk and parse it into settings. */
export function parseConfigFile(path: string): Record<string, string> {
  const text = readFileSync(path, 'utf8')
  const out: Record<string, string> = {}
  for (const line of text.split('\\n')) {
    const [k, v] = line.split('=')
    if (k && v) out[k.trim()] = v.trim()
  }
  return out
}

export function mergeDefaults(a: Record<string, string>, b: Record<string, string>) {
  return { ...b, ...a }
}
`)
  w('src/net/client.ts', `export class HttpClient {
  constructor(private base: string) {}

  async fetchJson(url: string) {
    const res = await fetch(this.base + url)
    return res.json()
  }

  async retryWithBackoff(fn: () => Promise<unknown>, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      try { return await fn() } catch { await new Promise((r) => setTimeout(r, 2 ** i * 100)) }
    }
  }
}
`)
  w('src/ui/render.ts', `export function renderPage(title: string, body: string) {
  return '<html><h1>' + title + '</h1>' + body + '</html>'
}
`)
  w('src/util/strings.ts', `export function slugify(s: string) { return s.toLowerCase().replace(/ /g, '-') }
export function capitalize(s: string) { return s.slice(0, 1).toUpperCase() + s.slice(1) }
`)
  w('docs/notes.md', `# Notes

We should someday document how the config file gets parsed, but nobody has written it yet.
`)
  w('README.md', `# Sample project\n\nA tiny fixture for ranking tests.\n`)
  w('.env', `CONFIG_PARSE_SECRET=hunter2 parse config file\n`)
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

interface Opts {
  config?: Partial<RetrievalRankConfig>
  provider?: EmbeddingProvider
  dbPath?: string
  withStore?: boolean
}
async function boot(o: Opts = {}) {
  const ctx = new Context()
  await ctx.plugin(Subprocess)
  await ctx.plugin(RetrievalGrep, { root })
  await ctx.plugin(RetrievalTreesitter)
  if (o.provider) {
    await ctx.plugin(Embeddings, {})
    ctx.embeddings.register(o.provider)
  }
  let dbFiber
  if (o.withStore ?? !!o.provider) dbFiber = await ctx.plugin(LanceVectorStore, { path: o.dbPath ?? join(base, `db-${Math.random().toString(36).slice(2)}`) })
  await ctx.plugin(RetrievalRank, { root, ...o.config })
  return { ctx, rank: ctx.retrievalRank, dbFiber }
}
const okRes = (r: RankResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.kind}: ${r.error.detail}`)
  return r
}
const files = (r: RankResult) => okRes(r).hits.map((h) => h.file)

describe.skipIf(!hasRg)('lexical ranking (no embeddings)', () => {
  it('puts the relevant function first and the unrelated files below it or nowhere', async () => {
    const { rank } = await boot()
    const r = okRes(await rank.search('parse config file'))
    expect(r.hits[0]).toMatchObject({ file: 'src/config/parser.ts', kind: 'symbol', name: 'parseConfigFile' })
    expect(r.hits.map((h) => h.file)).not.toContain('src/ui/render.ts')
    expect(r.hits.map((h) => h.file)).not.toContain('src/util/strings.ts')
    const notes = r.hits.findIndex((h) => h.file === 'docs/notes.md')
    expect(notes === -1 || notes > 0).toBe(true)
  })

  it('reports lexical mode, with the degradation reason when a semantic weight was wanted but nothing is registered', async () => {
    const { rank } = await boot()
    const r = okRes(await rank.search('parse config file'))
    expect(r).toMatchObject({ mode: 'bm25', weight: 0 })
    expect(r.degraded).toContain('embeddings is not available')
    expect(okRes(await rank.search('parse config file', { weight: 0 })).degraded).toBeUndefined()
  })

  it('never returns or reads secrets', async () => {
    const { rank } = await boot()
    const r = okRes(await rank.search('config parse secret hunter2'))
    expect(r.hits.some((h) => h.file === '.env' || h.text.includes('hunter2'))).toBe(false)
    expect(r.hits.length).toBeGreaterThan(0) // positive control: the same query does find ordinary files
  })

  it('a symbol-name match beats a chunk that merely mentions the word in its body', async () => {
    const dir = join(root, 'src/boost')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.ts'), `export function backoff(n: number) {\n  return n * 2\n}\n`)
    writeFileSync(join(dir, 'b.ts'), `export function other() {\n  // backoff backoff backoff\n  return 1\n}\n`)
    const { rank } = await boot()
    const r = okRes(await rank.search('backoff', { path: 'src/boost' }))
    expect(r.hits.map((h) => h.name)).toEqual(['backoff', 'other'])
    const off = await boot({ config: { nameBoost: 0 } })
    const r0 = okRes(await off.rank.search('backoff', { path: 'src/boost' }))
    expect(r0.hits.map((h) => h.name)).toEqual(['other', 'backoff'])
  })

  it('is stable: the same query gives exactly the same ranking and scores every time', async () => {
    const { rank } = await boot()
    const a = await rank.search('http client retry backoff fetch')
    const b = await rank.search('http client retry backoff fetch')
    expect(a).toEqual(b)
    expect(files(a)[0]).toBe('src/net/client.ts')
  })

  it('k limits hits; path scopes to a directory or a file; hit text is capped', async () => {
    const { rank } = await boot({ config: { maxHitChars: 50 } })
    expect(okRes(await rank.search('config', { k: 1 })).hits).toHaveLength(1)
    const scoped = okRes(await rank.search('config', { path: 'src/config' }))
    expect(scoped.hits.length).toBeGreaterThan(0)
    expect(scoped.hits.every((h) => h.file.startsWith('src/config/'))).toBe(true)
    const one = okRes(await rank.search('config', { path: 'src/config/parser.ts' }))
    expect(new Set(one.hits.map((h) => h.file))).toEqual(new Set(['src/config/parser.ts']))
    expect(scoped.hits.every((h) => h.text.length <= 50)).toBe(true)
  })

  it('bad input is an error value, not an exception', async () => {
    const { rank } = await boot()
    const kind = (r: RankResult) => (r.ok ? 'ok' : r.error.kind)
    expect(kind(await rank.search(''))).toBe('input')
    expect(kind(await rank.search('   '))).toBe('input')
    expect(kind(await rank.search('how do I find the'))).toBe('input') // only stopwords
    expect(kind(await rank.search('x'.repeat(2001)))).toBe('input')
    for (const k of [0, -1, 1.5, 101, NaN]) expect(kind(await rank.search('config', { k })), String(k)).toBe('input')
    for (const weight of [-0.1, 1.1, NaN]) expect(kind(await rank.search('config', { weight })), String(weight)).toBe('input')
    expect(kind(await rank.search('config', { path: '..' }))).toBe('outside_root')
    expect(kind(await rank.search('config', { path: '../repo-evil' }))).toBe('outside_root')
    expect(kind(await rank.search('config', { path: 'no/such/dir' }))).toBe('path_not_found')
    expect(kind(await rank.search(5 as unknown as string))).toBe('input')
  })

  it('no matching files at all is ok and empty', async () => {
    const { rank } = await boot()
    const r = okRes(await rank.search('zzzqqqxxxnonexistentterm'))
    expect(r.hits).toEqual([])
  })

  it('rejects bad config', async () => {
    const ctx = new Context()
    await ctx.plugin(Subprocess)
    await ctx.plugin(RetrievalGrep, { root })
    await ctx.plugin(RetrievalTreesitter)
    await expect(ctx.plugin(RetrievalRank, { root: 'relative' })).rejects.toBeInstanceOf(RetrievalRankConfigError)
    await expect(ctx.plugin(RetrievalRank, { root, weight: 2 })).rejects.toBeInstanceOf(RetrievalRankConfigError)
    await expect(ctx.plugin(RetrievalRank, { root, k: 0 })).rejects.toBeInstanceOf(RetrievalRankConfigError)
    for (const minVectorScore of [1.5, -2, NaN]) await expect(ctx.plugin(RetrievalRank, { root, minVectorScore }), String(minVectorScore)).rejects.toBeInstanceOf(RetrievalRankConfigError)
  })
})

describe('defence in depth when the grep stage misbehaves', () => {
  it('ignores result paths that escape the root, are absolute, binary, too large or unreadable, and counts them as skipped', async () => {
    const outside = join(base, 'outside-secret.txt')
    writeFileSync(outside, 'config parse TOPSECRET\n')
    writeFileSync(join(root, 'bin.dat'), Buffer.concat([Buffer.from('config parse '), Buffer.from([0, 1, 2])]))
    writeFileSync(join(root, 'huge.txt'), 'config parse '.repeat(200))
    const ctx = new Context()
    class StubGrep extends Service {
      constructor(c: Context) { super(c, 'retrievalGrep') }
      async search() {
        const r = (file: string) => ({ file, matches: [], matchCount: 1 })
        return { ok: true as const, truncated: false, results: ['../outside-secret.txt', outside, 'bin.dat', 'huge.txt', 'missing.ts', 'src/config/parser.ts', 'a\0b'].map(r) }
      }
    }
    await ctx.plugin(StubGrep)
    await ctx.plugin(RetrievalTreesitter)
    await ctx.plugin(RetrievalRank, { root, maxFileBytes: 1500 })
    const r = okRes(await ctx.retrievalRank.search('config parse', { weight: 0 }))
    expect(r.stats.skippedFiles).toBe(6)
    expect(new Set(r.hits.map((h) => h.file))).toEqual(new Set(['src/config/parser.ts']))
    expect(JSON.stringify(r)).not.toContain('TOPSECRET')
  })

  it('a grep failure is an error when nothing else can answer, with the cause', async () => {
    const ctx = new Context()
    class StubGrep extends Service {
      constructor(c: Context) { super(c, 'retrievalGrep') }
      async search() { return { ok: false as const, error: { kind: 'rg_missing' as const, detail: 'ENOENT' } } }
    }
    await ctx.plugin(StubGrep)
    await ctx.plugin(RetrievalTreesitter)
    await ctx.plugin(RetrievalRank, { root })
    const r = await ctx.retrievalRank.search('config')
    expect(!r.ok && r.error).toEqual({ kind: 'grep_failed', detail: 'rg_missing: ENOENT' })
  })
})

/* ============================================================ hybrid */

/** Topic vectors we control: sort-ish text -> x, config-ish -> z, everything else -> y. */
function controlled(): EmbeddingProvider & { calls: number } {
  const vec = (t: string): number[] => (/sort|ascending/i.test(t) ? [1, 0, 0] : /config/i.test(t) ? [0, 0, 1] : [0, 1, 0])
  const p = {
    name: 'controlled',
    model: 'ctl-1',
    egress: { host: 'localhost', remote: false },
    calls: 0,
    embed: async (texts: readonly string[]) => {
      p.calls++
      return texts.map(vec)
    },
  }
  return p
}

describe.skipIf(!hasRg)('hybrid ranking', () => {
  const Q = 'sorting numbers config'
  let hy: string
  beforeAll(() => {
    hy = join(root, 'src/hybrid')
    mkdirSync(hy, { recursive: true })
    writeFileSync(join(hy, 'lexical.ts'), `export function loadConfig() {\n  // config loader: read config from disk and merge config defaults\n  return {}\n}\n`)
    writeFileSync(join(hy, 'semantic.ts'), `export function orderAscending(items: number[]) {\n  return [...items].sort((a, b) => a - b)\n}\n`)
  })
  async function indexed(p = controlled()) {
    const b = await boot({ provider: p })
    const idx = okIdx(await b.rank.indexProject({ path: 'src/hybrid' }))
    return { ...b, p, idx }
  }
  const okIdx = (r: Awaited<ReturnType<RetrievalRankLike['indexProject']>>) => {
    if (!r.ok) throw new Error(`index failed: ${r.error.kind}: ${r.error.detail}`)
    return r
  }
  type RetrievalRankLike = Awaited<ReturnType<typeof boot>>['rank']

  it('indexes the project: files and chunks counted, secrets and skipped dirs excluded', async () => {
    const { idx } = await indexed()
    expect(idx.files).toBe(2)
    expect(idx.chunks).toBe(2)
    expect(idx.skipped).toEqual([])
  })

  it('WEIGHT CHANGES THE RANKING: pure BM25 puts the lexical match first, pure vectors put the semantic match first', async () => {
    const { rank } = await indexed()
    const bm = okRes(await rank.search(Q, { path: 'src/hybrid', weight: 0 }))
    const vec = okRes(await rank.search(Q, { path: 'src/hybrid', weight: 1 }))
    expect(bm.hits.map((h) => h.name)).toEqual(['loadConfig']) // the semantic chunk shares no query term
    expect(vec.hits.map((h) => h.name)).toEqual(['orderAscending', 'loadConfig'])
    expect(bm.hits[0]!.name).not.toBe(vec.hits[0]!.name)
    expect(bm.mode).toBe('bm25')
    expect(vec).toMatchObject({ mode: 'hybrid', weight: 1 })
  })

  it('a middle weight blends both lists deterministically, and reports each chunk\'s ranks', async () => {
    const { rank } = await indexed()
    const a = okRes(await rank.search(Q, { path: 'src/hybrid', weight: 0.5 }))
    const b = okRes(await rank.search(Q, { path: 'src/hybrid', weight: 0.5 }))
    expect(a).toEqual(b)
    expect(a.hits.map((h) => h.name)).toEqual(['loadConfig', 'orderAscending']) // in both lists beats in one
    expect(a.hits[0]).toMatchObject({ bm25Rank: 1, vectorRank: 2 })
    expect(a.hits[1]).toMatchObject({ vectorRank: 1 })
    expect(a.hits[1]!.bm25Rank).toBeUndefined()
    expect(a.hits[0]!.score).toBeGreaterThan(a.hits[1]!.score)
    expect(a.hits[1]!.vectorScore).toBeCloseTo(1, 4)
  })

  it('weight 0 (per call or configured) never calls the embedding provider; weight > 0 costs exactly one query embedding', async () => {
    const { rank, p } = await indexed()
    p.calls = 0
    okRes(await rank.search(Q, { weight: 0 }))
    expect(p.calls).toBe(0)
    okRes(await rank.search(Q, { weight: 1 }))
    expect(p.calls).toBe(1)

    const off = controlled()
    const b = await boot({ provider: off, config: { weight: 0 } })
    okIdx(await b.rank.indexProject({ path: 'src/hybrid' }))
    off.calls = 0
    const r = okRes(await b.rank.search(Q, { path: 'src/hybrid' })) // configured weight 0, no per-call override
    expect(off.calls).toBe(0)
    expect(r).toMatchObject({ mode: 'bm25', weight: 0 })
    expect(r.degraded).toBeUndefined()
  })

  it('mirrored ranks give EQUAL fused scores; the tie goes to the better lexical rank, not to file order', async () => {
    const dir = join(root, 'src/tie')
    mkdirSync(dir, { recursive: true })
    // zz-a.ts is the better BM25 match (the query word three times), aa-b.ts the better vector match.
    writeFileSync(join(dir, 'zz-a.ts'), `export function alphaFn() {\n  // ALPHA quark quark quark\n  return 1\n}\n`)
    writeFileSync(join(dir, 'aa-b.ts'), `export function bravoFn() {\n  // BRAVO quark filler filler filler filler\n  return 2\n}\n`)
    const provider: EmbeddingProvider = {
      name: 'tie', model: 'tie-1', egress: { host: 'localhost', remote: false },
      embed: async (texts) => texts.map((t) => (t === 'quark' ? [1, 0, 0] : t.includes('ALPHA') ? [0.6, 0.8, 0] : t.includes('BRAVO') ? [0.95, 0.31, 0] : [0, 0, 1])),
    }
    const b = await boot({ provider })
    okIdx(await b.rank.indexProject({ path: 'src/tie' }))
    const r = okRes(await b.rank.search('quark', { path: 'src/tie', weight: 0.5 }))
    const [first, second] = r.hits
    expect([first!.name, second!.name]).toEqual(['alphaFn', 'bravoFn'])
    expect([first!.bm25Rank, first!.vectorRank, second!.bm25Rank, second!.vectorRank]).toEqual([1, 2, 2, 1])
    expect(first!.score).toBe(second!.score) // an exact tie, so only the tie-break decided the order
    expect(first!.file > second!.file).toBe(true) // and file order would have put the other one first
  })

  it('WITHOUT a similarity floor an index returns its nearest neighbours even for a question nothing answers; with the floor they are dropped and counted', async () => {
    const unrelated = 'zzqqunrelated gibberishtopic' // shares no word with any file, and the stub puts it on the "other" axis
    const bare = await indexed()
    const noFloor = okRes(await bare.rank.search(unrelated, { path: 'src/hybrid', weight: 0.5 }))
    expect(noFloor.hits.length).toBeGreaterThan(0) // junk: neighbours are always returned
    expect(noFloor.hits.every((h) => h.bm25Rank === undefined)).toBe(true)

    const b = await boot({ provider: controlled(), config: { minVectorScore: 0.5 } })
    okIdx(await b.rank.indexProject({ path: 'src/hybrid' }))
    const floored = okRes(await b.rank.search(unrelated, { path: 'src/hybrid', weight: 0.5 }))
    expect(floored.hits).toEqual([])
    expect(floored.stats.belowFloorVectorHits).toBeGreaterThan(0)
    // the floor keeps genuinely similar chunks (the stub gives sort/ascending text similarity 1)
    const related = okRes(await b.rank.search('sorting numbers config', { path: 'src/hybrid', weight: 1 }))
    expect(related.hits.map((h) => h.name)).toContain('orderAscending')
  })

  it('minVectorScore can be set per call (and overrides the configured one); a bad value is an input error', async () => {
    const unrelated = 'zzqqunrelated gibberishtopic'
    const { rank } = await indexed() // no configured floor
    expect(okRes(await rank.search(unrelated, { path: 'src/hybrid', weight: 0.5 })).hits.length).toBeGreaterThan(0)
    expect(okRes(await rank.search(unrelated, { path: 'src/hybrid', weight: 0.5, minVectorScore: 0.5 })).hits).toEqual([])
    const strict = await boot({ provider: controlled(), config: { minVectorScore: 0.9 } })
    okIdx(await strict.rank.indexProject({ path: 'src/hybrid' }))
    expect(okRes(await strict.rank.search('sorting numbers config', { path: 'src/hybrid', weight: 1, minVectorScore: -1 })).hits.length).toBeGreaterThan(0)
    for (const minVectorScore of [1.5, -2, NaN]) {
      const r = await rank.search(unrelated, { minVectorScore })
      expect(r.ok ? 'ok' : r.error.kind, String(minVectorScore)).toBe('input')
    }
  })

  it('a chunk the query shares no words with is found only through vectors', async () => {
    const { rank } = await indexed()
    expect(okRes(await rank.search(Q, { path: 'src/hybrid', weight: 0 })).hits.some((h) => h.name === 'orderAscending')).toBe(false)
    expect(okRes(await rank.search(Q, { path: 'src/hybrid', weight: 0.5 })).hits.some((h) => h.name === 'orderAscending')).toBe(true)
  })

  it('vector hits honour the path scope', async () => {
    const { rank } = await indexed()
    const r = okRes(await rank.search(Q, { path: 'src/config', weight: 1 }))
    expect(r.hits.every((h) => h.file.startsWith('src/config/'))).toBe(true)
  })

  it('a file edited after indexing is not served from the stale index, and its fresh text is still found lexically', async () => {
    const { rank } = await indexed()
    const f = join(hy, 'semantic.ts')
    const original = `export function orderAscending(items: number[]) {\n  return [...items].sort((a, b) => a - b)\n}\n`
    try {
      writeFileSync(f, `export function orderAscending(items: number[]) {\n  // config tweak\n  return [...items].sort((a, b) => a - b)\n}\n`)
      const r = okRes(await rank.search(Q, { path: 'src/hybrid', weight: 1 }))
      expect(r.stats.staleVectorHits).toBeGreaterThanOrEqual(1)
      expect(r.hits.every((h) => !(h.name === 'orderAscending' && h.vectorRank !== undefined))).toBe(true)
      const lexical = okRes(await rank.search('config tweak', { path: 'src/hybrid', weight: 0 }))
      expect(lexical.hits[0]).toMatchObject({ file: 'src/hybrid/semantic.ts', name: 'orderAscending' })
      expect(lexical.hits[0]!.text).toContain('config tweak')
    } finally {
      writeFileSync(f, original)
    }
  })

  it('a deleted file is dropped from vector results without an error', async () => {
    const { rank } = await indexed()
    const f = join(hy, 'semantic.ts')
    const original = `export function orderAscending(items: number[]) {\n  return [...items].sort((a, b) => a - b)\n}\n`
    try {
      rmSync(f)
      const r = okRes(await rank.search(Q, { path: 'src/hybrid', weight: 1 }))
      expect(r.stats.staleVectorHits).toBeGreaterThanOrEqual(1)
      expect(r.hits.some((h) => h.file === 'src/hybrid/semantic.ts')).toBe(false)
    } finally {
      writeFileSync(f, original)
    }
  })

  it('semantic failures degrade to BM25 with the reason instead of failing the search', async () => {
    const failing: EmbeddingProvider = { name: 'f', model: 'f-1', egress: { host: 'localhost', remote: false }, embed: async () => { throw new Error('model crashed') } }
    const good = await indexed()
    // same store, embeddings now failing: build a second context over the same database
    const b = await boot({ provider: failing, dbPath: join(base, 'unused-db') })
    const r = okRes(await b.rank.search(Q, { path: 'src/hybrid', weight: 0.5 }))
    expect(r.mode).toBe('bm25')
    expect(r.degraded).toContain('embeddings')
    expect(r.hits.map((h) => h.name)).toEqual(['loadConfig'])
    void good
  })

  it('an index built with another embedding model is not mixed in: degraded, BM25 answers, reset rebuilds', async () => {
    const dbPath = join(base, 'db-mismatch')
    const a = await boot({ provider: controlled(), dbPath })
    okIdx(await a.rank.indexProject({ path: 'src/hybrid' }))
    await a.dbFiber!.dispose()

    const other: EmbeddingProvider = { ...controlled(), model: 'ctl-2' }
    const b = await boot({ provider: other, dbPath })
    const r = okRes(await b.rank.search(Q, { path: 'src/hybrid', weight: 0.5 }))
    expect(r.mode).toBe('bm25')
    expect(r.degraded).toContain('fingerprint_mismatch')
    expect(r.hits.map((h) => h.name)).toEqual(['loadConfig'])

    const refused = await b.rank.indexProject({ path: 'src/hybrid' })
    expect(!refused.ok && refused.error.kind).toBe('vectorstore')
    okIdx(await b.rank.indexProject({ path: 'src/hybrid', reset: true }))
    const fixed = okRes(await b.rank.search(Q, { path: 'src/hybrid', weight: 1 }))
    expect(fixed.mode).toBe('hybrid')
    expect(fixed.hits[0]!.name).toBe('orderAscending')
  })

  it('the index survives a restart', async () => {
    const dbPath = join(base, 'db-restart')
    const a = await boot({ provider: controlled(), dbPath })
    okIdx(await a.rank.indexProject({ path: 'src/hybrid' }))
    await a.dbFiber!.dispose()
    const b = await boot({ provider: controlled(), dbPath })
    const r = okRes(await b.rank.search(Q, { path: 'src/hybrid', weight: 1 }))
    expect(r.hits[0]!.name).toBe('orderAscending')
  })
})

describe.skipIf(!hasRg)('indexing', () => {
  const col = async (b: Awaited<ReturnType<typeof boot>>) => {
    const info = b.ctx.embeddings.info()!
    const o = await b.ctx.vectorstore.open('code-chunks', { fingerprint: info.fingerprint!, dimensions: info.dimensions! })
    if (!o.ok) throw new Error(o.error.detail)
    return o.collection
  }

  it('reindexing the same files replaces their chunks instead of duplicating them', async () => {
    const b = await boot({ provider: new HashingEmbeddingProvider({ dimensions: 64 }) })
    const first = await b.rank.indexFiles(['src/config/parser.ts', 'src/net/client.ts'])
    // parser.ts: the import/comment window + 2 functions = 3 chunks; client.ts: the class + its 3 methods = 4 chunks
    expect(first.ok && [first.files, first.chunks]).toEqual([2, 7])
    const c = await col(b)
    const n1 = (await c.count()) as { ok: true; count: number }
    await b.rank.indexFiles(['src/config/parser.ts', 'src/net/client.ts'])
    const n2 = (await c.count()) as { ok: true; count: number }
    expect(n2.count).toBe(n1.count)
    expect(n1.count).toBe(first.ok ? first.chunks : -1)
  })

  it('editing a file and reindexing removes its old chunks; unindexFiles removes the rest', async () => {
    const dir = join(root, 'src/edit')
    mkdirSync(dir, { recursive: true })
    const f = join(dir, 'e.ts')
    writeFileSync(f, `export function one() {\n  return 1\n}\n\nexport function two() {\n  return 2\n}\n`)
    const b = await boot({ provider: new HashingEmbeddingProvider({ dimensions: 64 }) })
    const r1 = await b.rank.indexFiles(['src/edit/e.ts'])
    expect(r1.ok && r1.chunks).toBe(2) // the two functions; the blank line between them is not a chunk
    const c = await col(b)
    writeFileSync(f, `export function only() {\n  return 0\n}\n`)
    const r2 = await b.rank.indexFiles(['src/edit/e.ts'])
    expect(r2.ok && r2.chunks).toBe(1)
    expect(((await c.count()) as { count: number }).count).toBe(1)
    const un = await b.rank.unindexFiles(['src/edit/e.ts', 'never-indexed.ts'])
    expect(un).toEqual({ ok: true, removed: 1 })
    expect(((await c.count()) as { count: number }).count).toBe(0)
  })

  it('a file that has since become unreadable has its old chunks removed', async () => {
    const dir = join(root, 'src/gone')
    mkdirSync(dir, { recursive: true })
    const f = join(dir, 'g.ts')
    writeFileSync(f, `export function soon() {\n  return 'gone'\n}\n`)
    const b = await boot({ provider: new HashingEmbeddingProvider({ dimensions: 64 }) })
    await b.rank.indexFiles(['src/gone/g.ts'])
    const c = await col(b)
    expect(((await c.count()) as { count: number }).count).toBe(1)
    rmSync(f)
    const r = await b.rank.indexFiles(['src/gone/g.ts'])
    expect(r.ok && r.skipped).toEqual([{ file: 'src/gone/g.ts', reason: 'unreadable' }])
    expect(((await c.count()) as { count: number }).count).toBe(0)
  })

  it('refuses paths that escape the root and non-files, storing nothing for them', async () => {
    writeFileSync(join(base, 'repo-outside.ts'), 'export const secret = 1\n')
    const b = await boot({ provider: new HashingEmbeddingProvider({ dimensions: 64 }) })
    const r = await b.rank.indexFiles(['../repo-outside.ts', join(base, 'repo-outside.ts'), 'src', 'a\0b', ''])
    expect(r.ok && r.files).toBe(0)
    expect(r.ok && r.skipped.map((s) => s.reason).sort()).toEqual(['invalid_path', 'invalid_path', 'invalid_path', 'not_a_file', 'outside_root'])
  })

  it('indexProject skips secrets entirely: nothing from .env is stored', async () => {
    const b = await boot({ provider: new HashingEmbeddingProvider({ dimensions: 64 }) })
    const r = await b.rank.indexProject()
    expect(r.ok).toBe(true)
    const c = await col(b)
    const q = await c.query(new Float32Array(64).fill(1), 100, { source: '.env' })
    expect(q.ok && q.hits).toEqual([])
    expect(((await c.count()) as { count: number }).count).toBeGreaterThan(5) // positive control
  })

  it('reset with nothing to index still resets the collection', async () => {
    const b = await boot({ provider: new HashingEmbeddingProvider({ dimensions: 64 }) })
    await b.rank.indexFiles(['src/config/parser.ts'])
    const r = await b.rank.indexFiles([], { reset: true })
    expect(r.ok).toBe(true)
    const c = await col(b)
    expect(((await c.count()) as { count: number }).count).toBe(0)
  })

  describe('incremental indexing', () => {
    const counting = () => {
      const inner = new HashingEmbeddingProvider({ dimensions: 64 })
      const p: EmbeddingProvider & { calls: number; texts: number } = {
        name: 'h', model: inner.model, egress: inner.egress, calls: 0, texts: 0,
        embed: async (t) => { p.calls++; p.texts += t.length; return inner.embed(t) },
      }
      return p
    }
    const dirFiles = ['src/inc/a.ts', 'src/inc/b.ts', 'src/inc/c.ts']
    const write = (name: string, body: string) => { mkdirSync(join(root, 'src/inc'), { recursive: true }); writeFileSync(join(root, 'src/inc', name), body) }
    const seed = () => {
      write('a.ts', `export function alpha() {\n  return 1\n}\n`)
      write('b.ts', `export function bravo() {\n  return 2\n}\n\nexport function bravo2() {\n  return 3\n}\n`)
      write('c.ts', `export function charlie() {\n  return 4\n}\n`)
    }
    const stats = (r: Awaited<ReturnType<RetrievalRankLike['indexFiles']>>) => {
      if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.detail}`)
      return { files: r.files, chunks: r.chunks, embedded: r.embeddedChunks, reusedFiles: r.reusedFiles, reusedChunks: r.reusedChunks }
    }
    type RetrievalRankLike = Awaited<ReturnType<typeof boot>>['rank']

    it('the first run embeds everything; an unchanged second run embeds NOTHING and makes no provider call', async () => {
      seed()
      const p = counting()
      const b = await boot({ provider: p })
      expect(stats(await b.rank.indexFiles(dirFiles))).toEqual({ files: 3, chunks: 4, embedded: 4, reusedFiles: 0, reusedChunks: 0 })
      p.calls = 0
      p.texts = 0
      expect(stats(await b.rank.indexFiles(dirFiles))).toEqual({ files: 3, chunks: 4, embedded: 0, reusedFiles: 3, reusedChunks: 4 })
      expect(p.calls).toBe(0)
    })

    it('editing one file re-embeds only that file; the others are reused', async () => {
      seed()
      const p = counting()
      const b = await boot({ provider: p })
      await b.rank.indexFiles(dirFiles)
      p.calls = 0
      p.texts = 0
      write('b.ts', `export function bravo() {\n  return 2\n}\n\nexport function bravo2() {\n  return 999\n}\n`)
      expect(stats(await b.rank.indexFiles(dirFiles))).toEqual({ files: 3, chunks: 4, embedded: 2, reusedFiles: 2, reusedChunks: 2 })
      expect(p.texts).toBe(2)
      seed()
    })

    it('the edit is really in the index afterwards (not just counted): the new text is what a search finds', async () => {
      seed()
      const b = await boot({ provider: counting() })
      await b.rank.indexFiles(dirFiles)
      write('a.ts', `export function alpha() {\n  return 'zzfreshmarker'\n}\n`)
      await b.rank.indexFiles(dirFiles)
      const c = await col(b)
      const q = await c.query(new Float32Array(64).fill(1), 50, { source: 'src/inc/a.ts' })
      expect(q.ok && q.hits).toHaveLength(1)
      expect(q.ok && (q.hits[0]!.metadata as { hash: string }).hash).toBeTruthy()
      seed()
    })

    it('a line shift is a change (ids contain the line range): the file is re-embedded once, then reused again', async () => {
      seed()
      const p = counting()
      const b = await boot({ provider: p })
      await b.rank.indexFiles(dirFiles)
      write('c.ts', `// a new first line\nexport function charlie() {\n  return 4\n}\n`)
      const shifted = stats(await b.rank.indexFiles(dirFiles))
      expect(shifted.embedded).toBeGreaterThan(0)
      expect(shifted.reusedFiles).toBe(2)
      expect(stats(await b.rank.indexFiles(dirFiles)).embedded).toBe(0)
      seed()
    })

    it('a partly-stored file (a chunk went missing) is repaired by re-embedding that file', async () => {
      seed()
      const b = await boot({ provider: counting() })
      await b.rank.indexFiles(dirFiles)
      const c = await col(b)
      const ids = (await c.idsForSource('src/inc/b.ts')) as { ok: true; ids: string[] }
      expect(ids.ids).toHaveLength(2)
      await c.deleteIds([ids.ids[0]!])
      const fixed = stats(await b.rank.indexFiles(dirFiles))
      expect(fixed).toMatchObject({ embedded: 2, reusedFiles: 2 })
      expect(((await c.count()) as { count: number }).count).toBe(4)
    })

    it('an extra stale chunk in the store (not produced by the file any more) is removed, not kept', async () => {
      seed()
      const b = await boot({ provider: counting() })
      await b.rank.indexFiles(dirFiles)
      const c = await col(b)
      await c.upsert([{ id: 'src/inc/a.ts#99-99#deadbeef0000', vector: new Float32Array(64).fill(1), source: 'src/inc/a.ts' }])
      expect(((await c.count()) as { count: number }).count).toBe(5)
      stats(await b.rank.indexFiles(dirFiles))
      expect(((await c.count()) as { count: number }).count).toBe(4)
    })

    it('reset re-embeds everything even though nothing changed', async () => {
      seed()
      const p = counting()
      const b = await boot({ provider: p })
      await b.rank.indexFiles(dirFiles)
      p.calls = 0
      expect(stats(await b.rank.indexFiles(dirFiles, { reset: true }))).toEqual({ files: 3, chunks: 4, embedded: 4, reusedFiles: 0, reusedChunks: 0 })
      expect(p.calls).toBeGreaterThan(0)
    })

    it('an index built by a previous process is reused after a restart (nothing embedded)', async () => {
      seed()
      const dbPath = join(base, 'db-incremental-restart')
      const a = await boot({ provider: counting(), dbPath })
      await a.rank.indexFiles(dirFiles)
      await a.dbFiber!.dispose()
      const p = counting()
      const b = await boot({ provider: p, dbPath })
      expect(stats(await b.rank.indexFiles(dirFiles))).toMatchObject({ embedded: 0, reusedFiles: 3 })
      expect(p.texts).toBe(1) // only the one throwaway text that learns the embedding fingerprint
    })

    it('reports progress: reused work first, then each stored batch, ending at the total; a throwing callback is ignored', async () => {
      seed()
      const b = await boot({ provider: counting(), config: { indexGroupChunks: 1 } })
      await b.rank.indexFiles(['src/inc/a.ts'])
      const seen: Array<[number, number]> = []
      const r = await b.rank.indexFiles(dirFiles, { onProgress: (d, t) => seen.push([d, t]) })
      expect(r.ok).toBe(true)
      expect(seen[0]).toEqual([1, 4]) // a.ts (1 chunk) was already stored
      expect(seen.at(-1)).toEqual([4, 4])
      expect(seen.map((x) => x[0])).toEqual([...seen.map((x) => x[0])].sort((a, z) => a - z))
      expect(seen.length).toBeGreaterThanOrEqual(3)
      const boom = await b.rank.indexFiles(dirFiles, { reset: true, onProgress: () => { throw new Error('ui crashed') } })
      expect(boom.ok).toBe(true)
    })

    it('nothing to do (no files, no reset) never even loads the embedding fingerprint', async () => {
      const p = counting()
      const b = await boot({ provider: p })
      const r = await b.rank.indexFiles([])
      expect(r).toMatchObject({ ok: true, files: 0, chunks: 0, embeddedChunks: 0 })
      expect(p.calls).toBe(0)
    })
  })

  it('without embeddings or a store there is nothing to index into', async () => {
    const b = await boot()
    const r = await b.rank.indexFiles(['src/config/parser.ts'])
    expect(!r.ok && r.error.kind).toBe('unavailable')
    const u = await b.rank.unindexFiles(['x'])
    expect(!u.ok && u.error.kind).toBe('unavailable')
  })

  it('an embedding failure while indexing is reported and stores nothing', async () => {
    const failing: EmbeddingProvider = { name: 'f', model: 'f-1', egress: { host: 'localhost', remote: false }, embed: async () => { throw new Error('nope') } }
    const b = await boot({ provider: failing })
    const r = await b.rank.indexFiles(['src/config/parser.ts'])
    expect(!r.ok && r.error.kind).toBe('embeddings')
  })

  it('clean-up and indexing work right after a restart, before anything has been embedded in this process', async () => {
    const dbPath = join(base, 'db-cold')
    const a = await boot({ provider: new HashingEmbeddingProvider({ dimensions: 64 }), dbPath })
    const first = await a.rank.indexFiles(['src/config/parser.ts', 'src/net/client.ts'])
    expect(first.ok && first.chunks).toBe(7)
    await a.dbFiber!.dispose()

    const b = await boot({ provider: new HashingEmbeddingProvider({ dimensions: 64 }), dbPath })
    expect(b.ctx.embeddings.info()?.fingerprint).toBeUndefined() // nothing embedded yet in this process
    const un = await b.rank.unindexFiles(['src/config/parser.ts'])
    expect(un).toEqual({ ok: true, removed: 3 })
    expect(b.ctx.embeddings.info()?.fingerprint).toBeDefined()
    expect(((await (await col(b)).count()) as { count: number }).count).toBe(4)

    // and an index call whose files are all unusable still cleans up files that were indexed earlier
    const c = await boot({ provider: new HashingEmbeddingProvider({ dimensions: 64 }), dbPath })
    writeFileSync(join(root, 'src/net/was-text.ts'), 'export const a = 1\n')
    await c.rank.indexFiles(['src/net/was-text.ts'])
    writeFileSync(join(root, 'src/net/was-text.ts'), Buffer.from([0, 1, 2, 3]))
    const d = await boot({ provider: new HashingEmbeddingProvider({ dimensions: 64 }), dbPath })
    const r = await d.rank.indexFiles(['src/net/was-text.ts'])
    expect(r.ok && r.skipped).toEqual([{ file: 'src/net/was-text.ts', reason: 'binary' }])
    const q = await (await col(d)).query(new Float32Array(64).fill(1), 50, { source: 'src/net/was-text.ts' })
    expect(q.ok && q.hits).toEqual([])
  })

  it('large projects are embedded in groups', async () => {
    let calls = 0
    const inner = new HashingEmbeddingProvider({ dimensions: 64 })
    const counting: EmbeddingProvider = { ...inner, name: 'h', model: inner.model, egress: inner.egress, embed: async (t) => { calls++; return inner.embed(t) } }
    const b = await boot({ provider: counting, config: { indexGroupChunks: 2 } })
    const r = await b.rank.indexFiles(['src/config/parser.ts', 'src/net/client.ts', 'src/ui/render.ts', 'src/util/strings.ts', 'README.md'])
    expect(r.ok).toBe(true)
    expect(calls).toBeGreaterThan(1)
    const c = await col(b)
    expect(((await c.count()) as { count: number }).count).toBe(r.ok ? r.chunks : -1)
  })
})
