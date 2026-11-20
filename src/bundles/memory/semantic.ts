import { Service, type Context } from 'cordis'
import { SemanticFactStore, type SemanticReindexCheckpoint } from './semantic-store.js'
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
 * Facts live in an append-only event log with a rebuildable ID/text index.
 * Legacy semantic.json files are migrated without being deleted. The vector
 * collection is only a search index over facts: vectors from one embedding
 * model are useless under another (D-027 fingerprint rule), so the index must
 * be rebuildable, and `reindex()` rebuilds it from the facts.
 *
 * A separate service from `ctx.memory` on purpose: the episodic and hot tiers
 * need no embeddings or vector store, and `profile-minimal` has neither.
 */
export class MemorySemantic extends Service {
  static inject = ['egress', 'embeddings', 'vectorstore']

  private readonly store: SemanticFactStore
  private queue: Promise<unknown> = Promise.resolve()
  private pendingOperations = 0
  private readonly maxPendingOperations: number
  private readonly reindexBatchSize: number
  private readonly collectionName: string
  private readonly maxText: number
  private readonly maxWhy: number
  private readonly maxFacts: number
  private readonly maxFactBytes: number
  private readonly now: () => Date

  constructor(ctx: Context, config: SemanticConfig = {}) {
    super(ctx, 'memorySemantic')
    this.store = new SemanticFactStore(config.path)
    this.maxPendingOperations = config.maxPendingOperations ?? 256
    if (!Number.isSafeInteger(this.maxPendingOperations) || this.maxPendingOperations < 1) {
      throw new MemoryError('memory: semantic maxPendingOperations must be a positive safe integer')
    }
    this.reindexBatchSize = config.reindexBatchSize ?? 64
    if (!Number.isSafeInteger(this.reindexBatchSize) || this.reindexBatchSize < 1) {
      throw new MemoryError('memory: semantic reindexBatchSize must be a positive safe integer')
    }
    this.collectionName = config.collection ?? 'memory-semantic'
    this.maxText = config.maxTextChars ?? 1000
    this.maxWhy = config.maxWhyChars ?? 500
    this.maxFacts = config.maxFacts ?? 10_000
    this.maxFactBytes = config.maxFactBytes ?? 8_192
    if (!Number.isSafeInteger(this.maxFacts) || this.maxFacts < 1 || !Number.isSafeInteger(this.maxFactBytes) || this.maxFactBytes < 1) {
      throw new MemoryError('memory: maxFacts and maxFactBytes must be positive safe integers')
    }
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

    const ts = this.now().toISOString()
    const fact: SemanticFact = {
      tier: 'semantic',
      id: id ?? randomUUID(),
      text,
      why,
      ...(tags?.length ? { tags: tags.map(oneLine).filter(Boolean) } : {}),
      ...(source ? { source } : {}),
      ts,
      ...(id ? { updatedTs: ts } : {}),
    }
    const result = await this.exclusive(() => this.store.put(fact, { maxFacts: this.maxFacts, maxFactBytes: this.maxFactBytes }))
    if (!result.created) return { fact: this.safeFact(result.fact), created: false }

    const indexed = await this.indexOneIfCurrent(result.fact)
    return indexed.ok ? { fact: this.safeFact(result.fact), created: true, indexed: true } : { fact: this.safeFact(result.fact), created: true, indexed: false, indexError: `${indexed.error.kind}: ${indexed.error.detail}` }
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
    // Avoid paying for an embedding when the semantic tier is empty. Check under
    // the same cross-process lock used by mutations, then recheck before reading
    // the index because the facts may change while the provider is embedding.
    const empty = await this.exclusive(async () => (await this.store.count()) === 0)
    if (empty) return { ok: true, hits: [], stale: false }
    const emb = await this.ctx.embeddings.embed([text], { kind: 'query' })
    if (!emb.ok) return { ok: false, error: { kind: `embedding_${emb.error.kind}`, detail: emb.error.detail } }
    return this.exclusive(async () => {
      const factsCount = await this.store.count()
      if (factsCount === 0) return { ok: true as const, hits: [], stale: false }
      const col = await this.collection()
      if (!col.ok) return col
      const found = await col.collection.query(emb.vectors[0]!, k)
      if (!found.ok) return found
      const count = await col.collection.count()
      const hits: SemanticHit[] = []
      for (const h of found.hits) {
        const fact = await this.store.get(h.id) // orphaned vectors are ignored
        if (fact && (opts.minScore === undefined || h.score >= opts.minScore)) hits.push({ fact: this.safeFact(fact), score: h.score })
      }
      return { ok: true as const, hits, stale: count.ok ? count.count !== factsCount : true }
    })
  }

  /** Resume a source-version-bound semantic index rebuild in idempotent batches. */
  async reindex(opts: { reset?: boolean } = {}): Promise<{ ok: true; indexed: number } | SemanticFailure> {
    if (!this.store.persistent) {
      return this.exclusive(async () => {
        const count = await this.store.count()
        if (count === 0) return { ok: true as const, indexed: 0 }
        return this.index(this.store.iterate(), opts.reset === true)
      })
    }

    let state = await this.exclusive(async () => ({
      count: await this.store.count(),
      sourceBytes: await this.store.revision(),
      checkpoint: await this.store.loadReindexCheckpoint(),
    }))
    if (state.count === 0) {
      await this.exclusive(() => this.store.clearReindexCheckpoint())
      return { ok: true, indexed: 0 }
    }

    let checkpoint = state.checkpoint
    if (checkpoint && checkpoint.sourceBytes !== state.sourceBytes) {
      await this.exclusive(() => this.store.clearReindexCheckpoint())
      checkpoint = undefined
    }
    let cursor = checkpoint?.cursor
    let indexed = checkpoint?.indexed ?? 0
    let resetRequested = checkpoint?.resetRequested ?? (opts.reset === true)
    let resetApplied = checkpoint?.resetApplied ?? false
    let page = await this.exclusive(() => this.store.page(cursor, this.reindexBatchSize))
    if (page.sourceBytes !== state.sourceBytes) {
      await this.exclusive(() => this.store.clearReindexCheckpoint())
      return { ok: false, error: { kind: 'source_changed', detail: 'semantic facts changed while reindexing; retry reindex() to start from the new source version' } }
    }
    if (page.items.length === 0) {
      await this.exclusive(() => this.store.clearReindexCheckpoint())
      return { ok: true, indexed }
    }

    let embedded = await this.ctx.embeddings.embed(page.items.map((fact) => fact.text), { kind: 'document' })
    if (!embedded.ok) return { ok: false, error: { kind: `embedding_${embedded.error.kind}`, detail: embedded.error.detail } }
    let batchVectors = embedded.vectors
    let info = this.ctx.embeddings.info()
    if (!info?.fingerprint || !info.dimensions) return { ok: false, error: { kind: 'embedding_config', detail: 'no embedding fingerprint yet (no provider, or no vector produced)' } }

    const checkpointMatches = !!checkpoint &&
      checkpoint.sourceBytes === state.sourceBytes &&
      checkpoint.fingerprint === info.fingerprint &&
      checkpoint.dimensions === info.dimensions &&
      checkpoint.collection === this.collectionName &&
      (opts.reset !== true || checkpoint.resetRequested)
    if (!checkpointMatches) {
      const reuseFirstBatch = !checkpoint && cursor === undefined
      cursor = undefined
      indexed = 0
      resetRequested = opts.reset === true
      resetApplied = false
      page = await this.exclusive(() => this.store.page(undefined, this.reindexBatchSize))
      if (!reuseFirstBatch) {
        embedded = await this.ctx.embeddings.embed(page.items.map((fact) => fact.text), { kind: 'document' })
        if (!embedded.ok) return { ok: false, error: { kind: `embedding_${embedded.error.kind}`, detail: embedded.error.detail } }
        batchVectors = embedded.vectors
      }
      info = this.ctx.embeddings.info()
      if (!info?.fingerprint || !info.dimensions) return { ok: false, error: { kind: 'embedding_config', detail: 'no embedding fingerprint yet (no provider, or no vector produced)' } }
    }

    let collection: VectorCollection | undefined
    for (;;) {
      const committed = await this.exclusive(async () => {
        const currentRevision = await this.store.revision()
        if (currentRevision !== state.sourceBytes) return { changed: true as const }
        if (!collection) {
          const opened = await this.collection(!resetApplied && resetRequested)
          if (!opened.ok) return { failure: opened as SemanticFailure }
          collection = opened.collection
          resetApplied = true
          const prepared: SemanticReindexCheckpoint = {
            version: 1,
            sourceBytes: state.sourceBytes,
            fingerprint: info!.fingerprint!,
            dimensions: info!.dimensions!,
            collection: this.collectionName,
            resetRequested,
            resetApplied,
            ...(cursor ? { cursor } : {}),
            indexed,
            updatedAt: new Date().toISOString(),
          }
          await this.store.saveReindexCheckpoint(prepared)
        }
        const up = await collection!.upsert(page.items.map((fact, index) => ({
          id: fact.id,
          vector: batchVectors[index]!,
          source: 'memory.semantic',
          metadata: { tier: 'semantic' },
        })))
        if (!up.ok) return { failure: up as SemanticFailure }
        const nextCursor = page.items[page.items.length - 1]!.id
        const nextIndexed = indexed + page.items.length
        const committedRevision = await this.store.revision()
        if (committedRevision !== state.sourceBytes) return { changed: true as const }
        await this.store.saveReindexCheckpoint({
          version: 1,
          sourceBytes: state.sourceBytes,
          fingerprint: info!.fingerprint!,
          dimensions: info!.dimensions!,
          collection: this.collectionName,
          resetRequested,
          resetApplied: true,
          cursor: nextCursor,
          indexed: nextIndexed,
          updatedAt: new Date().toISOString(),
        })
        return { changed: false as const, cursor: nextCursor, indexed: nextIndexed }
      })
      if ('failure' in committed && committed.failure) return committed.failure
      if (committed.changed) {
        await this.exclusive(() => this.store.clearReindexCheckpoint())
        return { ok: false, error: { kind: 'source_changed', detail: 'semantic facts changed during a reindex batch; retry reindex() to rebuild from the current source version' } }
      }
      cursor = committed.cursor
      indexed = committed.indexed
      page = await this.exclusive(() => this.store.page(cursor, this.reindexBatchSize))
      if (page.sourceBytes !== state.sourceBytes) {
        await this.exclusive(() => this.store.clearReindexCheckpoint())
        return { ok: false, error: { kind: 'source_changed', detail: 'semantic facts changed while reindexing; retry reindex() to start from the new source version' } }
      }
      if (page.items.length === 0) {
        const finalRevision = await this.exclusive(() => this.store.revision())
        if (finalRevision !== state.sourceBytes) {
          await this.exclusive(() => this.store.clearReindexCheckpoint())
          return { ok: false, error: { kind: 'source_changed', detail: 'semantic facts changed before reindex completed; retry reindex()' } }
        }
        await this.exclusive(() => this.store.clearReindexCheckpoint())
        return { ok: true, indexed }
      }
      embedded = await this.ctx.embeddings.embed(page.items.map((fact) => fact.text), { kind: 'document' })
      if (!embedded.ok) return { ok: false, error: { kind: `embedding_${embedded.error.kind}`, detail: embedded.error.detail } }
      batchVectors = embedded.vectors
    }
  }

  /** Remove a fact and its vector. Returns false if there was no such fact. */
  async remove(id: string): Promise<boolean> {
    const gone = await this.exclusive(() => this.store.delete(id))
    if (!gone) return false
    // Best effort: if the index is unreachable, query() ignores the orphaned vector anyway.
    const emb = await this.ctx.embeddings.embed([gone.text])
    if (emb.ok) {
      try {
        await this.exclusive(async () => {
          // A same-id add may have completed while embedding the removed fact.
          // Never delete the replacement's vector.
          if (await this.store.get(id)) return
          const col = await this.collection()
          if (col.ok) await col.collection.deleteIds([id])
        })
      } catch (error) {
        // The fact is already removed from the source of truth. A saturated queue
        // may leave an orphaned vector, which query() filters against current facts.
        if (!(error instanceof MemoryError && error.message.includes('semantic operation queue is full'))) throw error
      }
    }
    return true
  }

  async list(): Promise<SemanticFact[]> {
    return this.exclusive(async () => (await this.store.all()).map((fact) => this.safeFact(fact)))
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

  private async index(facts: AsyncIterable<SemanticFact>, reset = false): Promise<{ ok: true; indexed: number } | SemanticFailure> {
    let collection: VectorCollection | undefined
    let batch: SemanticFact[] = []
    let indexed = 0
    const flush = async (): Promise<SemanticFailure | undefined> => {
      if (!batch.length) return undefined
      const current = batch
      batch = []
      const emb = await this.ctx.embeddings.embed(current.map((fact) => fact.text), { kind: 'document' })
      if (!emb.ok) return { ok: false, error: { kind: `embedding_${emb.error.kind}`, detail: emb.error.detail } }
      if (!collection) {
        const opened = await this.collection(reset)
        if (!opened.ok) return opened
        collection = opened.collection
      }
      const up = await collection.upsert(current.map((fact, index) => ({
        id: fact.id, vector: emb.vectors[index]!, source: 'memory.semantic', metadata: { tier: 'semantic' },
      })))
      if (!up.ok) return up
      indexed += current.length
      return undefined
    }
    for await (const fact of facts) {
      batch.push(fact)
      if (batch.length >= this.reindexBatchSize) {
        const error = await flush()
        if (error) return error
      }
    }
    const error = await flush()
    return error ?? { ok: true, indexed }
  }

  /** Embed outside the shared lock, then verify the persisted version before writing its vector. */
  private async indexOneIfCurrent(fact: SemanticFact): Promise<{ ok: true } | SemanticFailure> {
    const emb = await this.ctx.embeddings.embed([fact.text], { kind: 'document' })
    if (!emb.ok) return { ok: false, error: { kind: 'embedding_' + emb.error.kind, detail: emb.error.detail } }
    try {
      return await this.exclusive(async () => {
        const current = await this.store.get(fact.id)
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
    } catch (error) {
      if (error instanceof MemoryError && error.message.includes('semantic operation queue is full')) {
        return { ok: false, error: { kind: 'queue_full', detail: error.message } }
      }
      throw error
    }
  }

  /** Needs the embedding fingerprint, which only exists once a vector has been produced in this process. */
  private async collection(reset = false): Promise<{ ok: true; collection: VectorCollection } | SemanticFailure> {
    const info = this.ctx.embeddings.info()
    if (!info?.fingerprint || !info.dimensions) return { ok: false, error: { kind: 'embedding_config', detail: 'no embedding fingerprint yet (no provider, or no vector produced)' } }
    const opened = await this.ctx.vectorstore.open(this.collectionName, { fingerprint: info.fingerprint, dimensions: info.dimensions, owner: 'memory.semantic', reset })
    if (!opened.ok) {
      const hint = opened.error.kind === 'fingerprint_mismatch' ? ' (the embedding model changed: call reindex({ reset: true }))' : ''
      return { ok: false, error: { kind: opened.error.kind, detail: opened.error.detail + hint } }
    }
    return { ok: true, collection: opened.collection }
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.pendingOperations >= this.maxPendingOperations) {
      throw new MemoryError(`memory: semantic operation queue is full (${this.pendingOperations}/${this.maxPendingOperations})`)
    }
    this.pendingOperations++
    const job = this.queue.then(() => this.store.withLock(fn))
    this.queue = job.catch(() => {})
    void job.then(() => { this.pendingOperations-- }, () => { this.pendingOperations-- })
    return job
  }
}
