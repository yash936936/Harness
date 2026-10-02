import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { Context, Service } from 'cordis'
import type { VectorCollection } from '../vectorstore-lancedb/types.js'
import {
  chunkSource,
  looksBinary,
  sliceChunkText,
  splitLines,
  textHash,
  type Chunk,
  type ChunkOptions,
} from './chunk.js'
import { bm25, queryTerms, tokenize } from './text.js'
import {
  RetrievalRankConfigError,
  type IndexOptions,
  type IndexResult,
  type IndexSkip,
  type RankHit,
  type RankResult,
  type RankStats,
  type RetrievalRankConfig,
  type SearchOptions,
} from './types.js'

export * from './types.js'
export { chunkSource, sliceChunkText, looksBinary, type Chunk } from './chunk.js'
export { bm25, queryTerms, tokenize } from './text.js'

declare module 'cordis' {
  interface Context {
    retrievalRank: RetrievalRank
  }
}

const MAX_QUERY_CHARS = 2000
const MAX_K = 100

type FileRead = { ok: true; text: string; lines: string[] } | { ok: false; reason: IndexSkip['reason'] }

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  if (rel === '') return true
  if (isAbsolute(rel)) return false
  return rel !== '..' && !rel.startsWith('..' + sep)
}

/**
 * `ctx.retrievalRank` — the last stage of the retrieval pipeline. Lexical candidates come from
 * ripgrep (2.1), chunks from tree-sitter symbols (2.2), scored with BM25; when embeddings (2.3) and
 * the vector store (2.4) are available and `weight > 0`, chunks indexed there are fused in with
 * weighted reciprocal-rank fusion. Every semantic failure degrades to BM25 instead of failing the search.
 */
export class RetrievalRank extends Service {
  static inject = ['retrievalGrep', 'retrievalParse']

  private readonly root: string
  private readonly collectionName: string
  private readonly k: number
  private readonly weight: number
  private readonly rrfK: number
  private readonly vectorTopK: number
  private readonly minVectorScore: number | undefined
  private readonly maxFileBytes: number
  private readonly chunkOpts: ChunkOptions
  private readonly nameBoost: number
  private readonly bm25Params: { k1: number; b: number }
  private readonly maxCandidateChunks: number
  private readonly maxHitChars: number
  private readonly indexGroupChunks: number

  constructor(ctx: Context, config: RetrievalRankConfig) {
    super(ctx, 'retrievalRank')
    if (!config?.root || !isAbsolute(config.root)) throw new RetrievalRankConfigError('retrieval-rank: config.root must be an absolute path')
    this.root = config.root
    this.collectionName = config.collection ?? 'code-chunks'
    this.k = config.k ?? 10
    this.weight = config.weight ?? 0.5
    this.rrfK = config.rrfK ?? 60
    this.vectorTopK = config.vectorTopK ?? 50
    this.minVectorScore = config.minVectorScore
    this.maxFileBytes = config.maxFileBytes ?? 1_000_000
    this.chunkOpts = { windowLines: config.windowLines ?? 40, maxChunkLines: config.maxChunkLines ?? 80, maxChunkChars: config.maxChunkChars ?? 6000 }
    this.nameBoost = config.nameBoost ?? 2
    this.bm25Params = config.bm25 ?? { k1: 1.2, b: 0.75 }
    this.maxCandidateChunks = config.maxCandidateChunks ?? 3000
    this.maxHitChars = config.maxHitChars ?? 1500
    this.indexGroupChunks = config.indexGroupChunks ?? 512
    if (!(this.weight >= 0 && this.weight <= 1)) throw new RetrievalRankConfigError('retrieval-rank: weight must be between 0 and 1')
    if (this.minVectorScore !== undefined && !(this.minVectorScore >= -1 && this.minVectorScore <= 1)) throw new RetrievalRankConfigError('retrieval-rank: minVectorScore must be between -1 and 1')
    for (const [n, v] of [['k', this.k], ['rrfK', this.rrfK], ['vectorTopK', this.vectorTopK], ['windowLines', this.chunkOpts.windowLines], ['maxChunkLines', this.chunkOpts.maxChunkLines], ['indexGroupChunks', this.indexGroupChunks]] as const) {
      if (!Number.isInteger(v) || v < 1) throw new RetrievalRankConfigError(`retrieval-rank: ${n} must be a positive integer`)
    }
  }

  /* ---------------------------------------------------------------- files */

  private realRoot(): string | undefined {
    try {
      return realpathSync(this.root)
    } catch {
      return undefined
    }
  }

  /** Read a root-relative file safely: inside the real root, a regular file, not too big, not binary. */
  private readFile(rel: string, realRoot: string, cache?: Map<string, FileRead>): FileRead {
    const hit = cache?.get(rel)
    if (hit) return hit
    const r = this.readFileUncached(rel, realRoot)
    cache?.set(rel, r)
    return r
  }

  private readFileUncached(rel: string, realRoot: string): FileRead {
    if (typeof rel !== 'string' || rel === '' || rel.includes('\0') || isAbsolute(rel)) return { ok: false, reason: 'invalid_path' }
    let real: string
    try {
      real = realpathSync(resolve(realRoot, rel))
    } catch {
      return { ok: false, reason: 'unreadable' }
    }
    if (!isInside(realRoot, real)) return { ok: false, reason: 'outside_root' }
    try {
      const st = statSync(real)
      if (!st.isFile()) return { ok: false, reason: 'not_a_file' }
      if (st.size > this.maxFileBytes) return { ok: false, reason: 'too_large' }
      const buf = readFileSync(real)
      if (looksBinary(buf)) return { ok: false, reason: 'binary' }
      const text = buf.toString('utf8')
      return { ok: true, text, lines: splitLines(text) }
    } catch {
      return { ok: false, reason: 'unreadable' }
    }
  }

  private async chunksOf(rel: string, file: Extract<FileRead, { ok: true }>): Promise<Chunk[]> {
    const parsed = await this.ctx.retrievalParse.parse(file.text, { filename: rel })
    return chunkSource(rel, file.text, parsed.ok ? parsed.file.symbols : undefined, this.chunkOpts)
  }

  /* --------------------------------------------------------------- search */

  async search(query: string, opts: SearchOptions = {}): Promise<RankResult> {
    if (typeof query !== 'string' || query.trim() === '') return { ok: false, error: { kind: 'input', detail: 'query must be a non-empty string' } }
    if (query.length > MAX_QUERY_CHARS) return { ok: false, error: { kind: 'input', detail: `query is longer than ${MAX_QUERY_CHARS} characters` } }
    const k = opts.k ?? this.k
    if (!Number.isInteger(k) || k < 1 || k > MAX_K) return { ok: false, error: { kind: 'input', detail: `k must be an integer from 1 to ${MAX_K}` } }
    const wanted = opts.weight ?? this.weight
    if (!(wanted >= 0 && wanted <= 1)) return { ok: false, error: { kind: 'input', detail: 'weight must be between 0 and 1' } }
    const floor = opts.minVectorScore ?? this.minVectorScore
    if (floor !== undefined && !(floor >= -1 && floor <= 1)) return { ok: false, error: { kind: 'input', detail: 'minVectorScore must be between -1 and 1' } }
    const { tokens, grepTerms } = queryTerms(query)
    if (tokens.length === 0) return { ok: false, error: { kind: 'input', detail: 'the query has no searchable terms (only stopwords or single characters)' } }

    const realRoot = this.realRoot()
    if (!realRoot) return { ok: false, error: { kind: 'path_not_found', detail: 'root does not exist' } }
    let scope = ''
    if (opts.path !== undefined) {
      let target: string
      try {
        target = realpathSync(resolve(realRoot, opts.path))
      } catch {
        return { ok: false, error: { kind: 'path_not_found', detail: opts.path } }
      }
      if (!isInside(realRoot, target)) return { ok: false, error: { kind: 'outside_root', detail: opts.path } }
      scope = relative(realRoot, target).split(sep).join('/')
    }
    const inScope = (file: string): boolean => scope === '' || file === scope || file.startsWith(scope + '/')

    const stats: RankStats = { candidateFiles: 0, candidateChunks: 0, skippedFiles: 0, staleVectorHits: 0, belowFloorVectorHits: 0 }
    const cache = new Map<string, FileRead>()

    // 1. semantic side first, so we know whether it will contribute
    const emb = wanted > 0 ? this.ctx.get('embeddings') : undefined
    const vs = wanted > 0 ? this.ctx.get('vectorstore') : undefined
    let degraded: string | undefined
    if (wanted > 0 && (!emb || !vs)) degraded = `${!emb ? 'embeddings' : 'vectorstore'} is not available`
    type VecHit = { key: string; file: string; startLine: number; endLine: number; kind: 'symbol' | 'window'; name?: string; text: string; score: number }
    const vecHits: VecHit[] = []
    if (emb && vs) {
      const sem = await this.semanticHits(emb, vs, query, realRoot, cache, stats, inScope, floor)
      if (sem.ok) vecHits.push(...sem.hits)
      else degraded = sem.reason
    }

    // 2. lexical candidates
    const chunks = new Map<string, Chunk>() // key: file:start-end
    const keyOf = (c: { file: string; startLine: number; endLine: number }) => `${c.file}:${c.startLine}-${c.endLine}`
    let grepFailure: string | undefined
    if (grepTerms.length > 0) {
      const g = await this.ctx.retrievalGrep.search(grepTerms.join('|'), opts.path !== undefined ? { path: opts.path } : {})
      if (!g.ok) {
        if (g.error.kind === 'outside_root' || g.error.kind === 'path_not_found') return { ok: false, error: { kind: g.error.kind, detail: opts.path ?? '' } }
        grepFailure = g.error.detail ? `${g.error.kind}: ${g.error.detail}` : g.error.kind
      } else {
        stats.candidateFiles = g.results.length
        for (const r of g.results) {
          if (chunks.size >= this.maxCandidateChunks) break
          const f = this.readFile(r.file, realRoot, cache)
          if (!f.ok) {
            stats.skippedFiles++
            continue
          }
          for (const c of await this.chunksOf(r.file, f)) {
            if (chunks.size >= this.maxCandidateChunks) break
            chunks.set(keyOf(c), c)
          }
        }
      }
    }
    stats.candidateChunks = chunks.size
    if (grepFailure && vecHits.length === 0) return { ok: false, error: { kind: 'grep_failed', detail: grepFailure } }

    // 3. BM25 over the lexical candidates
    const lexical = [...chunks.values()]
    const docs = lexical.map((c) => {
      const t = tokenize(c.text)
      const extra = tokenize(c.file)
      if (c.name) for (let i = 0; i < this.nameBoost; i++) extra.push(...tokenize(c.name))
      return t.concat(extra)
    })
    const scores = bm25(docs, tokens, this.bm25Params)
    const bm25Order = lexical
      .map((c, i) => ({ c, s: scores[i] as number }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || (a.c.file < b.c.file ? -1 : a.c.file > b.c.file ? 1 : a.c.startLine - b.c.startLine))
    const bm25Rank = new Map<string, number>(bm25Order.map((x, i) => [keyOf(x.c), i + 1]))

    // 4. fuse
    const w = vecHits.length > 0 ? wanted : 0
    const vecRank = new Map<string, number>(vecHits.map((h, i) => [h.key, i + 1]))
    const pool = new Map<string, RankHit>()
    const put = (key: string, base: Omit<RankHit, 'score'>) => {
      if (!pool.has(key)) pool.set(key, { ...base, score: 0 })
    }
    for (const x of bm25Order) put(keyOf(x.c), { file: x.c.file, startLine: x.c.startLine, endLine: x.c.endLine, kind: x.c.kind, ...(x.c.name ? { name: x.c.name } : {}), text: x.c.text })
    if (w > 0) for (const h of vecHits) put(h.key, { file: h.file, startLine: h.startLine, endLine: h.endLine, kind: h.kind, ...(h.name ? { name: h.name } : {}), text: h.text })
    for (const [key, hit] of pool) {
      const rb = bm25Rank.get(key)
      const rv = w > 0 ? vecRank.get(key) : undefined
      hit.score = (1 - w) * (rb ? 1 / (this.rrfK + rb) : 0) + w * (rv ? 1 / (this.rrfK + rv) : 0)
      if (rb) hit.bm25Rank = rb
      if (rv) {
        hit.vectorRank = rv
        hit.vectorScore = (vecHits[rv - 1] as VecHit).score
      }
      hit.text = hit.text.slice(0, this.maxHitChars)
    }
    const hits = [...pool.values()]
      .sort((a, b) => b.score - a.score || (a.bm25Rank ?? Infinity) - (b.bm25Rank ?? Infinity) || (a.file < b.file ? -1 : a.file > b.file ? 1 : a.startLine - b.startLine))
      .slice(0, k)
    return { ok: true, hits, mode: w > 0 ? 'hybrid' : 'bm25', weight: w, ...(degraded ? { degraded } : {}), stats }
  }

  /** Nearest indexed chunks to the query, re-validated against the files as they are now. */
  private async semanticHits(
    emb: Context['embeddings'],
    vs: Context['vectorstore'],
    query: string,
    realRoot: string,
    cache: Map<string, FileRead>,
    stats: RankStats,
    inScope: (file: string) => boolean,
    floor: number | undefined,
  ): Promise<{ ok: true; hits: Array<{ key: string; file: string; startLine: number; endLine: number; kind: 'symbol' | 'window'; name?: string; text: string; score: number }> } | { ok: false; reason: string }> {
    const e = await emb.embed([query], { kind: 'query' })
    if (!e.ok) return { ok: false, reason: `embeddings ${e.error.kind}: ${e.error.detail}` }
    const info = emb.info()
    if (!info?.fingerprint || !info.dimensions) return { ok: false, reason: 'embeddings did not report a fingerprint' }
    const opened = await vs.open(this.collectionName, { fingerprint: info.fingerprint, dimensions: info.dimensions })
    if (!opened.ok) return { ok: false, reason: `vectorstore ${opened.error.kind}: ${opened.error.detail}` }
    const q = await opened.collection.query(e.vectors[0] as Float32Array, this.vectorTopK)
    if (!q.ok) return { ok: false, reason: `vectorstore ${q.error.kind}: ${q.error.detail}` }

    const hits: Array<{ key: string; file: string; startLine: number; endLine: number; kind: 'symbol' | 'window'; name?: string; text: string; score: number }> = []
    for (const h of q.hits) {
      if (floor !== undefined && h.score < floor) {
        stats.belowFloorVectorHits++
        continue
      }
      const m = h.metadata as { file?: unknown; startLine?: unknown; endLine?: unknown; kind?: unknown; name?: unknown; hash?: unknown } | undefined
      if (!m || typeof m.file !== 'string' || typeof m.startLine !== 'number' || typeof m.endLine !== 'number' || typeof m.hash !== 'string') continue
      if (!inScope(m.file)) continue
      const f = this.readFile(m.file, realRoot, cache)
      const text = f.ok ? sliceChunkText(f.lines, m.startLine, m.endLine, this.chunkOpts.maxChunkChars) : undefined
      if (text === undefined || textHash(text) !== m.hash) {
        stats.staleVectorHits++ // the file changed or vanished since it was indexed
        continue
      }
      hits.push({
        key: `${m.file}:${m.startLine}-${m.endLine}`,
        file: m.file,
        startLine: m.startLine,
        endLine: m.endLine,
        kind: m.kind === 'symbol' ? 'symbol' : 'window',
        ...(typeof m.name === 'string' ? { name: m.name } : {}),
        text,
        score: h.score,
      })
    }
    return { ok: true, hits }
  }

  /* ------------------------------------------------------------- indexing */

  /**
   * The embedding fingerprint is only known after a first vector has been produced in this
   * process. If it is not known yet, embed one throwaway text to learn it (this is what lets
   * indexing, clean-up and `unindexFiles` work right after a restart).
   */
  private async fingerprintOf(emb: Context['embeddings']): Promise<{ fingerprint: string; dimensions: number } | { error: string }> {
    let info = emb.info()
    if (!info?.fingerprint || !info.dimensions) {
      const probe = await emb.embed(['dimension probe'], { kind: 'document' })
      if (!probe.ok) return { error: `embeddings ${probe.error.kind}: ${probe.error.detail}` }
      info = emb.info()
    }
    if (!info?.fingerprint || !info.dimensions) return { error: 'embeddings did not report a fingerprint' }
    return { fingerprint: info.fingerprint, dimensions: info.dimensions }
  }


  /** Chunk, embed and store the given root-relative files (replacing whatever was stored for them). */
  async indexFiles(files: readonly string[], opts: IndexOptions = {}): Promise<IndexResult> {
    const emb = this.ctx.get('embeddings')
    const vs = this.ctx.get('vectorstore')
    if (!emb || !vs) return { ok: false, error: { kind: 'unavailable', detail: `${!emb ? 'embeddings' : 'vectorstore'} is not available, so there is nothing to index into` } }
    if (!Array.isArray(files)) return { ok: false, error: { kind: 'input', detail: 'files must be an array of paths' } }
    const realRoot = this.realRoot()
    if (!realRoot) return { ok: false, error: { kind: 'path_not_found', detail: 'root does not exist' } }

    const skipped: IndexSkip[] = []
    const prepared: Array<{ file: string; chunks: Chunk[] }> = []
    const gone: string[] = [] // previously indexed files that can no longer be read: drop their chunks
    for (const rel of new Set(files)) {
      const f = this.readFile(rel, realRoot)
      if (!f.ok) {
        skipped.push({ file: String(rel), reason: f.reason })
        if (f.reason === 'unreadable' || f.reason === 'binary' || f.reason === 'too_large') gone.push(rel)
        continue
      }
      prepared.push({ file: rel, chunks: await this.chunksOf(rel, f) })
    }
    const totalChunks = prepared.reduce((n, p) => n + p.chunks.length, 0)
    let doneChunks = 0
    const progress = (): void => {
      try {
        opts.onProgress?.(doneChunks, totalChunks)
      } catch {
        // a broken progress callback must not break indexing
      }
    }

    const result = (extra: { embeddedChunks: number; reusedFiles: number; reusedChunks: number; embeddedFiles: number }): IndexResult => ({
      ok: true,
      files: extra.embeddedFiles + extra.reusedFiles,
      chunks: extra.embeddedChunks + extra.reusedChunks,
      embeddedChunks: extra.embeddedChunks,
      reusedFiles: extra.reusedFiles,
      reusedChunks: extra.reusedChunks,
      skipped,
    })
    if (prepared.length === 0 && gone.length === 0 && opts.reset !== true) return result({ embeddedChunks: 0, reusedFiles: 0, reusedChunks: 0, embeddedFiles: 0 })

    // Open the collection first: we need it to see what is already stored.
    const fp = await this.fingerprintOf(emb)
    if ('error' in fp) return { ok: false, error: { kind: 'embeddings', detail: fp.error } }
    const opened = await vs.open(this.collectionName, { fingerprint: fp.fingerprint, dimensions: fp.dimensions, reset: opts.reset === true })
    if (!opened.ok) return { ok: false, error: { kind: 'vectorstore', detail: `${opened.error.kind}: ${opened.error.detail}` } }
    const col = opened.collection

    // A file whose stored chunk ids are EXACTLY the ids it would produce now is unchanged: ids contain the
    // text hash and the line range, so any edit changes them. Those files cost nothing to "re-index".
    let reusedFiles = 0
    let reusedChunks = 0
    const todo: typeof prepared = []
    for (const p of prepared) {
      let same = false
      if (opts.reset !== true) {
        const existing = await col.idsForSource(p.file)
        if (!existing.ok) return { ok: false, error: { kind: 'vectorstore', detail: `${existing.error.kind}: ${existing.error.detail}` } }
        const have = new Set(existing.ids)
        same = have.size === p.chunks.length && p.chunks.every((c) => have.has(c.id))
      }
      if (same) {
        reusedFiles++
        reusedChunks += p.chunks.length
        doneChunks += p.chunks.length
      } else todo.push(p)
    }
    progress()

    // Group the changed files so that each embed call covers about indexGroupChunks chunks.
    const groups: Array<typeof prepared> = []
    let cur: typeof prepared = []
    let n = 0
    for (const p of todo) {
      cur.push(p)
      n += p.chunks.length
      if (n >= this.indexGroupChunks) {
        groups.push(cur)
        cur = []
        n = 0
      }
    }
    if (cur.length) groups.push(cur)

    let embeddedFiles = 0
    let embeddedChunks = 0
    for (const group of groups) {
      const all = group.flatMap((g) => g.chunks)
      let vectors: Float32Array[] = []
      if (all.length > 0) {
        const e = await emb.embed(all.map((c) => c.text), { kind: 'document' })
        if (!e.ok) return { ok: false, error: { kind: 'embeddings', detail: `${e.error.kind}: ${e.error.detail}` } }
        vectors = e.vectors
      }
      let at = 0
      for (const g of group) {
        const d = await col.deleteSource(g.file)
        if (!d.ok) return { ok: false, error: { kind: 'vectorstore', detail: `${d.error.kind}: ${d.error.detail}` } }
        const records = g.chunks.map((c, i) => ({
          id: c.id,
          vector: vectors[at + i] as Float32Array,
          source: g.file,
          metadata: { file: c.file, startLine: c.startLine, endLine: c.endLine, kind: c.kind, hash: c.id.slice(c.id.lastIndexOf('#') + 1), ...(c.name ? { name: c.name } : {}) },
        }))
        at += g.chunks.length
        const u = await col.upsert(records)
        if (!u.ok) return { ok: false, error: { kind: 'vectorstore', detail: `${u.error.kind}: ${u.error.detail}` } }
        embeddedFiles++
        embeddedChunks += g.chunks.length
      }
      doneChunks += all.length
      progress()
    }

    for (const f of gone) await col.deleteSource(f)
    return result({ embeddedChunks, reusedFiles, reusedChunks, embeddedFiles })
  }

  /** Index every file `retrievalGrep.listFiles` reports under `path` (default: the whole root). */
  async indexProject(opts: IndexOptions & { path?: string } = {}): Promise<IndexResult> {
    const l = await this.ctx.retrievalGrep.listFiles(opts.path !== undefined ? { path: opts.path } : {})
    if (!l.ok) {
      const kind = l.error.kind === 'outside_root' || l.error.kind === 'path_not_found' ? l.error.kind : 'grep_failed'
      return { ok: false, error: { kind, detail: l.error.detail ?? l.error.kind } }
    }
    return this.indexFiles(l.files, opts)
  }

  /** Remove everything indexed for these files (for example after deleting them). */
  async unindexFiles(files: readonly string[]): Promise<{ ok: true; removed: number } | { ok: false; error: { kind: 'unavailable' | 'vectorstore' | 'input'; detail: string } }> {
    const emb = this.ctx.get('embeddings')
    const vs = this.ctx.get('vectorstore')
    if (!emb || !vs) return { ok: false, error: { kind: 'unavailable', detail: 'embeddings or vectorstore is not available' } }
    const info = await this.fingerprintOf(emb)
    if ('error' in info) return { ok: false, error: { kind: 'unavailable', detail: info.error } }
    const o = await vs.open(this.collectionName, { fingerprint: info.fingerprint, dimensions: info.dimensions })
    if (!o.ok) return { ok: false, error: { kind: 'vectorstore', detail: `${o.error.kind}: ${o.error.detail}` } }
    let removed = 0
    for (const f of new Set(files)) {
      if (typeof f !== 'string' || f === '') return { ok: false, error: { kind: 'input', detail: 'every file must be a non-empty string' } }
      const d = await o.collection.deleteSource(f)
      if (!d.ok) return { ok: false, error: { kind: 'vectorstore', detail: `${d.error.kind}: ${d.error.detail}` } }
      removed += d.deleted
    }
    return { ok: true, removed }
  }
}

export const name = 'bundle-retrieval-rank'

export function apply(ctx: Context, config: RetrievalRankConfig): void {
  ctx.plugin(RetrievalRank, config)
}
