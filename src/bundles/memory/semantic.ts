import { Service, type Context } from 'cordis'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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
    this.now = config.now ?? (() => new Date())
  }

  /**
   * Store a fact. `why` is required: say what makes this non-trivial to
   * reconstruct from the code. Same `id` replaces the fact; the same text under
   * a different id is refused as a duplicate. The fact is saved first and then
   * indexed, so an embedding outage loses nothing (`indexed: false`).
   */
  async add(input: { text: string; why: string; id?: string; tags?: string[]; source?: string }): Promise<AddResult> {
    let text = oneLine(input.text ?? '')
    let why = oneLine(input.why ?? '')
    if (!text) throw new MemoryError('memory: semantic fact text is empty')
    if (!why) throw new MemoryError('memory: semantic fact needs a `why`: what makes it non-trivial to reconstruct from the code')
    const egress = this.ctx.egress
    text = clip(egress.redactValue(text), this.maxText)
    why = clip(egress.redactValue(why), this.maxWhy)

    let result!: { fact: SemanticFact; created: boolean }
    await this.mutate((list) => {
      const dup = list.find((f) => sameText(f.text, text) && f.id !== input.id)
      if (dup) {
        result = { fact: dup, created: false }
        return false
      }
      const i = input.id ? list.findIndex((f) => f.id === input.id) : -1
      const ts = this.now().toISOString()
      const fact: SemanticFact = {
        tier: 'semantic',
        id: input.id ?? randomUUID(),
        text,
        why,
        ...(input.tags?.length ? { tags: input.tags.map(oneLine).filter(Boolean) } : {}),
        ...(input.source ? { source: input.source } : {}),
        ts: i >= 0 ? list[i]!.ts : ts,
        ...(i >= 0 ? { updatedTs: ts } : {}),
      }
      if (i >= 0) list[i] = fact
      else list.push(fact)
      result = { fact, created: true }
      return true
    })
    if (!result.created) return result

    const indexed = await this.index([result.fact])
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
    if (!Number.isInteger(k) || k < 1 || k > 1000) throw new MemoryError('memory: query k must be an integer from 1 to 1000')
    if (!oneLine(text ?? '')) throw new MemoryError('memory: query text is empty')
    const facts = await this.load()
    if (facts.length === 0) return { ok: true, hits: [], stale: false }

    const emb = await this.ctx.embeddings.embed([text], { kind: 'query' })
    if (!emb.ok) return { ok: false, error: { kind: `embedding_${emb.error.kind}`, detail: emb.error.detail } }
    const col = await this.collection()
    if (!col.ok) return col
    const found = await col.collection.query(emb.vectors[0]!, k)
    if (!found.ok) return found
    const count = await col.collection.count()
    const byId = new Map(facts.map((f) => [f.id, f]))
    const hits: SemanticHit[] = []
    for (const h of found.hits) {
      const fact = byId.get(h.id) // a vector whose fact was removed is ignored, never returned
      if (fact && (opts.minScore === undefined || h.score >= opts.minScore)) hits.push({ fact: structuredClone(fact), score: h.score })
    }
    return { ok: true, hits, stale: count.ok ? count.count !== facts.length : true }
  }

  /** Rebuild the whole search index from the stored facts. Use `reset: true` after changing the embedding model. */
  async reindex(opts: { reset?: boolean } = {}): Promise<{ ok: true; indexed: number } | SemanticFailure> {
    const facts = await this.load()
    if (facts.length === 0) return { ok: true, indexed: 0 } // nothing to index; query() returns early on an empty tier
    const r = await this.index(facts, opts.reset === true)
    return r.ok ? { ok: true, indexed: facts.length } : r
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
      const col = await this.collection()
      if (col.ok) await col.collection.deleteIds([id])
    }
    return true
  }

  async list(): Promise<SemanticFact[]> {
    return structuredClone(await this.load())
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
    if (this.facts) return this.facts
    this.facts = []
    if (this.dir) {
      try {
        const parsed = JSON.parse(await readFile(this.file, 'utf8'))
        if (!Array.isArray(parsed)) throw new Error('not an array')
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
  private mutate(fn: (list: SemanticFact[]) => boolean): Promise<void> {
    const job = this.queue.then(async () => {
      const list = structuredClone(await this.load())
      if (!fn(list)) return
      if (this.dir) {
        await mkdir(this.dir, { recursive: true })
        const tmp = `${this.file}.${process.pid}.tmp`
        await writeFile(tmp, JSON.stringify(list, null, 2), 'utf8')
        await rename(tmp, this.file)
      }
      this.facts = list
    })
    this.queue = job.catch(() => {})
    return job
  }
}
