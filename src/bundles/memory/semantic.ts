import { Service, type Context } from 'cordis'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { assertNoSymlinkParents, readTextFileNoFollow } from '../../util/secure-file.js'
import { withFileLock } from '../../util/filelock.js'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { VectorCollection } from '../vectorstore-lancedb/index.js'
import { MemoryError, type SemanticConfig, type SemanticFact, type SemanticFailure, type SemanticHit } from './types.js'

declare module 'cordis' {
  interface Context {
    memorySemantic: MemorySemantic
  }
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}
function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + '…'
}
const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export interface AddResult {
  fact: SemanticFact
  /** false when this exact text was already stored (under another id) and nothing was written. */
  created: boolean
  /** Whether the search index now has it. Omitted for a duplicate. false = saved but not searchable yet; call `reindex()`. */
  indexed?: boolean
  indexError?: string
}

/**
 * `ctx.memorySemantic`: the semantic tier (3.3).
 *
 * The facts live in `semantic.json` (the source of truth). The vector
 * collection is only a search index over them: vectors from one embedding
 * model are useless under another (D-027 fingerprint rule), so the index must
 * be rebuildable, and `reindex()` rebuilds it from the facts.
 *
 * A separate service from `ctx.memory` on purpose: the episodic and hot tiers
 * need no embeddings or vector store, and `profile-minimal` has neither.
 */
export class MemorySemantic extends Service {
  static inject = ['egress', 'embeddings', 'vectorstore']

  private facts: SemanticFact[] | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private readonly dir: string | undefined
  private readonly collectionName: string
  private readonly maxText: number
  private readonly maxWhy: number
  private readonly now: () => Date

  constructor(ctx: Context, config: SemanticConfig = {}) {
    super(ctx, 'memorySemantic')
    this.dir = config.path
    this.collectionName = config.collection ?? 'memory-semantic'
    this.maxText = config.maxTextChars ?? 1000
    this.maxWhy = config.maxWhyChars ?? 500
    if (!Number.isSafeInteger(this.maxText) || this.maxText < 1 || !Number.isSafeInteger(this.maxWhy) || this.maxWhy < 1) {
      throw new MemoryError('memory: semantic maxTextChars and maxWhyChars must be positive safe integers')
    }
    this.now = config.now ?? (() => new Date())
  }

  /**
   * Store a fact. `why` is required: say what makes this non-trivial to
   * reconstruct from the code. Same `id` replaces the fact; the same text under
   * a different id is refused as a duplicate. The fact is saved first and then
   * indexed, so an embedding outage loses nothing (`indexed: false`).
   */
  async add(input: { text: string; why: string; id?: string; tags?: string[]; source?: string }): Promise<AddResult> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MemoryError('memory: semantic fact must be an object')
    if (typeof input.text !== 'string') throw new MemoryError('memory: semantic fact text must be a string')
    if (typeof input.why !== 'string') throw new MemoryError('memory: semantic fact why must be a string')
    if (input.id !== undefined && (typeof input.id !== 'string' || !input.id.trim() || input.id.includes('\0'))) throw new MemoryError('memory: semantic fact id must be a non-empty string without NUL')
    if (input.source !== undefined && typeof input.source !== 'string') throw new MemoryError('memory: semantic source must be a string')
    if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== 'string'))) throw new MemoryError('memory: semantic tags must be an array of strings')

    const egress = this.ctx.egress
    const id = input.id
    let text = clip(egress.redactValue(oneLine(input.text)), this.maxText)
    let why = clip(egress.redactValue(oneLine(input.why)), this.maxWhy)
    const source = input.source === undefined ? undefined : clip(oneLine(egress.redactValue(input.source)), this.maxWhy)
    const tags = input.tags?.map((tag) => clip(oneLine(egress.redactValue(tag)), 200)).filter(Boolean)
    if (!text) throw new MemoryError('memory: semantic fact text is empty')
    if (!why) throw new MemoryError('memory: semantic fact needs a `why`: what makes it non-trivial to reconstruct from the code')

    let result!: { fact: SemanticFact; created: boolean }
    await this.mutate((list) => {
      const dup = list.find((f) => sameText(f.text, text) && f.id !== id)
      if (dup) {
        result = { fact: this.safeFact(dup), created: false }
        return false
      }
      const i = id ? list.findIndex((f) => f.id === id) : -1
      const ts = this.now().toISOString()
      const fact: SemanticFact = {
        tier: 'semantic',
        id: id ?? randomUUID(),
        text,
        why,
        ...(tags?.length ? { tags: tags.map(oneLine).filter(Boolean) } : {}),
        ...(source ? { source } : {}),
        ts: i >= 0 ? list[i]!.ts : ts,
        ...(i >= 0 ? { updatedTs: ts } : {}),
      }
      if (i >= 0) list[i] = fact
      else list.push(fact)
      result = { fact, created: true }
      return true
    })
    if (!result.created) return result

    const indexed = await this.indexOneIfCurrent(result.fact)
    return indexed.ok ? { ...result, indexed: true } : { ...result, indexed: false, indexError: `${indexed.error.kind}: ${indexed.error.detail}` }
  }

  /**
   * Find facts by meaning. `stale: true` means the search index has a
   * different number of vectors than there are facts (some are not searchable
   * yet): run `reindex()`.
   */
  async query(
    text: string,
    opts: { k?: number; minScore?: number } = {},
  ): Promise<{ ok: true; hits: SemanticHit[]; stale: boolean } | SemanticFailure> {
    const k = opts.k ?? 5
    if (opts.minScore !== undefined && (!Number.isFinite(opts.minScore) || opts.minScore < 0 || opts.minScore > 1)) throw new MemoryError('memory: query minScore must be between 0 and 1')
    if (!Number.isInteger(k) || k < 1 || k > 1000) throw new MemoryError('memory: query k must be an integer from 1 to 1000')
    if (typeof text !== 'string' || !oneLine(text)) throw new MemoryError('memory: query text must be a non-empty string')
    const emb = await this.ctx.embeddings.embed([text], { kind: 'query' })
    if (!emb.ok) return { ok: false, error: { kind: `embedding_${emb.error.kind}`, detail: emb.error.detail } }
    return this.exclusive(async () => {
      const facts = await this.load()
      if (facts.length === 0) return { ok: true as const, hits: [], stale: false }
      const col = await this.collection()
      if (!col.ok) return col
      const found = await col.collection.query(emb.vectors[0]!, k)
      if (!found.ok) return found
      const count = await col.collection.count()
      const byId = new Map(facts.map((f) => [f.id, f]))
      const hits: SemanticHit[] = []
      for (const h of found.hits) {
        const fact = byId.get(h.id) // a vector whose fact was removed is ignored, never returned
        if (fact && (opts.minScore === undefined || h.score >= opts.minScore)) hits.push({ fact: this.safeFact(fact), score: h.score })
      }
      return { ok: true as const, hits, stale: count.ok ? count.count !== facts.length : true }
    })
  }

  /** Rebuild the whole search index from the stored facts. Use `reset: true` after changing the embedding model. */
  async reindex(opts: { reset?: boolean } = {}): Promise<{ ok: true; indexed: number } | SemanticFailure> {
    return this.exclusive(async () => {
      const facts = await this.load()
      if (facts.length === 0) return { ok: true as const, indexed: 0 } // nothing to index; query() returns early on an empty tier
      const r = await this.index(facts, opts.reset === true)
      return r.ok ? { ok: true as const, indexed: facts.length } : r
    })
  }

  /** Remove a fact and its vector. Returns false if there was no such fact. */
  async remove(id: string): Promise<boolean> {
    let gone: SemanticFact | undefined
    await this.mutate((list) => {
      const i = list.findIndex((f) => f.id === id)
      if (i < 0) return false
      gone = list.splice(i, 1)[0]
      return true
    })
    if (!gone) return false
    // Best effort: if the index is unreachable, query() ignores the orphaned vector anyway.
    const emb = await this.ctx.embeddings.embed([gone.text])
    if (emb.ok) {
      await this.exclusive(async () => {
        // A same-id add may have completed while embedding the removed fact.
        // Never delete the replacement's vector.
        if ((await this.load()).some((fact) => fact.id === id)) return
        const col = await this.collection()
        if (col.ok) await col.collection.deleteIds([id])
      })
    }
    return true
  }

  async list(): Promise<SemanticFact[]> {
    return (await this.load()).map((fact) => this.safeFact(fact))
  }

  /** Redact every model-visible field, including metadata loaded from older persisted files. */
  private safeFact(fact: SemanticFact): SemanticFact {
    const redact = (value: string) => this.ctx.egress.redactValue(value)
    return {
      ...structuredClone(fact),
      text: redact(fact.text),
      why: redact(fact.why),
      ...(fact.source !== undefined ? { source: redact(fact.source) } : {}),
      ...(fact.tags !== undefined ? { tags: fact.tags.map(redact) } : {}),
    }
  }

  // ---- index plumbing -------------------------------------------------------------------------

  private async index(facts: SemanticFact[], reset = false): Promise<{ ok: true } | SemanticFailure> {
    const emb = await this.ctx.embeddings.embed(facts.map((f) => f.text), { kind: 'document' })
    if (!emb.ok) return { ok: false, error: { kind: `embedding_${emb.error.kind}`, detail: emb.error.detail } }
    const col = await this.collection(reset)
    if (!col.ok) return col
    const up = await col.collection.upsert(
      facts.map((f, i) => ({ id: f.id, vector: emb.vectors[i]!, source: 'memory.semantic', metadata: { tier: 'semantic' } })),
    )
    return up.ok ? { ok: true } : up
  }

  /** Embed outside the shared lock, then verify the persisted version before writing its vector. */
  private async indexOneIfCurrent(fact: SemanticFact): Promise<{ ok: true } | SemanticFailure> {
    const emb = await this.ctx.embeddings.embed([fact.text], { kind: 'document' })
    if (!emb.ok) return { ok: false, error: { kind: 'embedding_' + emb.error.kind, detail: emb.error.detail } }
    return this.exclusive(async () => {
      const current = (await this.load()).find((item) => item.id === fact.id)
      if (!current || current.text !== fact.text) {
        return { ok: false as const, error: { kind: 'superseded', detail: 'semantic fact "' + fact.id + '" changed before its vector could be written; the newer mutation owns indexing' } }
      }
      const col = await this.collection()
      if (!col.ok) return col
      const up = await col.collection.upsert([
        { id: current.id, vector: emb.vectors[0]!, source: 'memory.semantic', metadata: { tier: 'semantic' } },
      ])
      return up.ok ? { ok: true as const } : up
    })
  }

  /** Needs the embedding fingerprint, which only exists once a vector has been produced in this process. */
  private async collection(reset = false): Promise<{ ok: true; collection: VectorCollection } | SemanticFailure> {
    const info = this.ctx.embeddings.info()
    if (!info?.fingerprint || !info.dimensions) return { ok: false, error: { kind: 'embedding_config', detail: 'no embedding fingerprint yet (no provider, or no vector produced)' } }
    const opened = await this.ctx.vectorstore.open(this.collectionName, { fingerprint: info.fingerprint, dimensions: info.dimensions, reset })
    if (!opened.ok) {
      const hint = opened.error.kind === 'fingerprint_mismatch' ? ' (the embedding model changed: call reindex({ reset: true }))' : ''
      return { ok: false, error: { kind: opened.error.kind, detail: opened.error.detail + hint } }
    }
    return { ok: true, collection: opened.collection }
  }

  // ---- fact file ------------------------------------------------------------------------------

  private get file() {
    return join(this.dir!, 'semantic.json')
  }

  private async load(): Promise<SemanticFact[]> {
    // BUG-09: shared file, so re-read it every time in directory mode; only the in-memory mode may use the cache.
    if (this.facts && !this.dir) return this.facts
    this.facts = []
    if (this.dir) {
      try {
        const parsed = JSON.parse(await readTextFileNoFollow(this.file))
        if (!Array.isArray(parsed)) throw new Error('not an array')
        for (const [index, fact] of parsed.entries()) {
          if (!fact || typeof fact !== 'object' || Array.isArray(fact) || fact.tier !== 'semantic' ||
            typeof fact.id !== 'string' || !fact.id.trim() ||
            typeof fact.text !== 'string' || !fact.text.trim() ||
            typeof fact.why !== 'string' || !fact.why.trim() ||
            typeof fact.ts !== 'string' || !Number.isFinite(Date.parse(fact.ts)) ||
            (fact.updatedTs !== undefined && (typeof fact.updatedTs !== 'string' || !Number.isFinite(Date.parse(fact.updatedTs)))) ||
            (fact.source !== undefined && typeof fact.source !== 'string') ||
            (fact.tags !== undefined && (!Array.isArray(fact.tags) || fact.tags.some((tag: unknown) => typeof tag !== 'string')))) {
            throw new Error(`invalid fact at index ${index}`)
          }
        }
        this.facts = parsed
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          this.facts = undefined
          throw new MemoryError(`memory: semantic.json is unreadable (${err?.message ?? err}); refusing to overwrite it`)
        }
      }
    }
    return this.facts!
  }

  /** Serialised read-modify-write; `fn` returns false when it changed nothing. Atomic file replace. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.queue.then(async () => {
      if (!this.dir) return fn()
      await assertNoSymlinkParents(this.file)
      await mkdir(this.dir, { recursive: true })
      await assertNoSymlinkParents(this.file)
      return withFileLock(`${this.file}.lock`, fn)
    })
    this.queue = job.catch(() => {})
    return job
  }

  private mutate(fn: (list: SemanticFact[]) => boolean): Promise<void> {
    const work = async () => {
      const list = structuredClone(await this.load())
      if (!fn(list)) return
      if (this.dir) {
        await assertNoSymlinkParents(this.file)
        await mkdir(this.dir, { recursive: true })
        await assertNoSymlinkParents(this.file)
        const tmp = `${this.file}.${process.pid}.${randomUUID()}.tmp`
        await writeFile(tmp, JSON.stringify(list, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        await assertNoSymlinkParents(this.file)
        await rename(tmp, this.file)
      }
      this.facts = list
    }
    return this.exclusive(work)
  }
}
