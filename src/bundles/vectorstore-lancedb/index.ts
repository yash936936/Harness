import { mkdirSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { Field, FixedSizeList, Float32, Schema, Utf8 } from 'apache-arrow'
import { Context, Service } from 'cordis'
import {
  VectorStoreConfigError,
  type OpenCollectionOptions,
  type VectorCollection,
  type VectorHit,
  type VectorRecord,
  type VectorStoreConfig,
  type VectorStoreErrorKind,
  type VectorStoreFailure,
  type VectorStoreResult,
} from './types.js'

export * from './types.js'

declare module 'cordis' {
  interface Context {
    vectorstore: LanceVectorStore
  }
}

type Lance = typeof import('@lancedb/lancedb')
type LanceConn = Awaited<ReturnType<Lance['connect']>>
type LanceTable = Awaited<ReturnType<LanceConn['openTable']>>

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/
const MAX_ID = 512
const MAX_SOURCE = 1024
const MAX_METADATA_CHARS = 65_536
const MAX_K = 1000
const MAX_DIMENSIONS = 16_384
const META_FINGERPRINT = 'harness.fingerprint'
const META_DIMENSIONS = 'harness.dimensions'

const fail = (kind: VectorStoreErrorKind, detail: string): VectorStoreFailure => ({ ok: false, error: { kind, detail } })
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Quote a value for a LanceDB filter. Only `'` needs doubling. Identifiers must be
 * BACKTICKED: a double-quoted name is treated as a string literal and silently matches
 * nothing (a delete would quietly do nothing).
 */
const sql = (s: string): string => `'${s.replace(/'/g, "''")}'`

function checkText(what: string, s: unknown, max: number): string | undefined {
  if (typeof s !== 'string' || s.length === 0) return `${what} must be a non-empty string`
  if (s.length > max) return `${what} is longer than ${max} characters`
  if (s.includes('\0')) return `${what} contains a NUL character`
  return undefined
}

/** Returns an error message, or a validated Float32Array. */
function checkVector(v: ArrayLike<number>, dimensions: number, what: string): string | Float32Array {
  if (v === null || v === undefined || typeof v.length !== 'number') return `${what} is not a vector`
  const out = Float32Array.from(v)
  if (out.length !== dimensions) return `${what} has ${out.length} dimensions, the collection has ${dimensions}`
  let norm = 0
  for (const x of out) {
    if (!Number.isFinite(x)) return `${what} contains a non-finite number`
    norm += x * x
  }
  if (norm === 0) return `${what} is all zeros, so its cosine similarity is undefined`
  return out
}

class LanceCollection implements VectorCollection {
  private closed = false
  private writes: Promise<unknown> = Promise.resolve()

  constructor(
    readonly name: string,
    readonly fingerprint: string,
    readonly dimensions: number,
    private readonly table: LanceTable,
  ) {}

  close(): void {
    if (this.closed) return
    this.closed = true
    this.table.close()
  }

  /** Writes run one at a time, in call order. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writes.then(fn, fn)
    this.writes = run.catch(() => undefined)
    return run
  }

  private guard<T extends object>(fn: () => Promise<VectorStoreResult<T>>): Promise<VectorStoreResult<T>> {
    if (this.closed) return Promise.resolve(fail('closed', `collection "${this.name}" is closed`))
    return fn().catch((e): VectorStoreFailure => fail(this.closed ? 'closed' : 'io', msg(e)))
  }

  upsert(records: readonly VectorRecord[]): Promise<VectorStoreResult<{ written: number }>> {
    return this.guard(async () => {
      // Validate everything first so a bad record never leaves a half-written batch.
      const rows = new Map<string, Record<string, unknown>>()
      for (let i = 0; i < records.length; i++) {
        const r = records[i] as VectorRecord
        const at = `record ${i}`
        const bad = checkText(`${at}: id`, r?.id, MAX_ID) ?? (r.source === undefined ? undefined : checkText(`${at}: source`, r.source, MAX_SOURCE))
        if (bad) return fail('input', bad)
        const vec = checkVector(r.vector, this.dimensions, `${at}: vector`)
        if (typeof vec === 'string') return fail(/dimensions/.test(vec) ? 'dimension_mismatch' : 'input', vec)
        let metadata: string | null = null
        if (r.metadata !== undefined) {
          if (r.metadata === null || typeof r.metadata !== 'object' || Array.isArray(r.metadata)) return fail('input', `${at}: metadata must be a plain object`)
          try {
            metadata = JSON.stringify(r.metadata)
          } catch (e) {
            return fail('input', `${at}: metadata is not JSON-serialisable (${msg(e)})`)
          }
          if (metadata.length > MAX_METADATA_CHARS) return fail('input', `${at}: metadata is longer than ${MAX_METADATA_CHARS} characters`)
        }
        // The same id twice in one batch would be inserted twice: keep the last.
        rows.delete(r.id)
        rows.set(r.id, { id: r.id, source: r.source ?? null, metadata, vector: vec })
      }
      if (rows.size === 0) return { ok: true, written: 0 }
      return this.serial(async () => {
        if (this.closed) return fail('closed', `collection "${this.name}" is closed`)
        await this.table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute([...rows.values()])
        return { ok: true as const, written: rows.size }
      })
    })
  }

  query(vector: ArrayLike<number>, k: number, opts: { source?: string } = {}): Promise<VectorStoreResult<{ hits: VectorHit[] }>> {
    return this.guard(async () => {
      if (!Number.isInteger(k) || k < 1 || k > MAX_K) return fail('input', `k must be an integer from 1 to ${MAX_K}`)
      const vec = checkVector(vector, this.dimensions, 'query vector')
      if (typeof vec === 'string') return fail(/dimensions/.test(vec) ? 'dimension_mismatch' : 'input', vec)
      if (opts.source !== undefined) {
        const bad = checkText('source', opts.source, MAX_SOURCE)
        if (bad) return fail('input', bad)
      }
      let q = this.table.vectorSearch(vec).distanceType('cosine').select(['id', 'source', 'metadata', '_distance']).limit(k)
      if (opts.source !== undefined) q = q.where(`\`source\` = ${sql(opts.source)}`)
      const rows = await q.toArray()
      const hits: VectorHit[] = rows.map((r: any) => {
        let metadata: Record<string, unknown> | undefined
        if (typeof r.metadata === 'string') {
          try {
            metadata = JSON.parse(r.metadata)
          } catch {
            metadata = undefined
          }
        }
        return {
          id: r.id as string,
          score: Math.max(-1, Math.min(1, 1 - Number(r._distance))),
          ...(typeof r.source === 'string' ? { source: r.source as string } : {}),
          ...(metadata ? { metadata } : {}),
        }
      })
      hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      return { ok: true, hits }
    })
  }

  deleteIds(ids: readonly string[]): Promise<VectorStoreResult<{ deleted: number }>> {
    return this.guard(async () => {
      for (const id of ids) {
        const bad = checkText('id', id, MAX_ID)
        if (bad) return fail('input', bad)
      }
      const unique = [...new Set(ids)]
      if (unique.length === 0) return { ok: true as const, deleted: 0 }
      // One filter is fine even for very long lists (200,000 ids took ~2s in testing).
      return this.serial(async () => ({ ok: true as const, deleted: (await this.table.delete(`id IN (${unique.map(sql).join(', ')})`)).numDeletedRows }))
    })
  }

  deleteSource(source: string): Promise<VectorStoreResult<{ deleted: number }>> {
    return this.guard(async () => {
      const bad = checkText('source', source, MAX_SOURCE)
      if (bad) return fail('input', bad)
      return this.serial(async () => ({ ok: true as const, deleted: (await this.table.delete(`\`source\` = ${sql(source)}`)).numDeletedRows }))
    })
  }

  count(): Promise<VectorStoreResult<{ count: number }>> {
    return this.guard(async () => ({ ok: true, count: await this.table.countRows() }))
  }
}

/**
 * `ctx.vectorstore`, backed by embedded LanceDB (no separate service). Exact
 * (brute-force) cosine search, which is fast enough for a project's worth of code
 * chunks; there is no ANN index yet.
 *
 * Each collection remembers the embedding fingerprint it was built with (stored in
 * the table's own schema metadata) and refuses to be opened under another one.
 * LanceDB is loaded lazily, so machines that cannot load its native binary only
 * fail when they use this bundle.
 */
export class LanceVectorStore extends Service {
  private readonly path: string
  private lance: Promise<Lance> | undefined
  private conn: Promise<LanceConn> | undefined
  private readonly collections = new Map<string, LanceCollection>()
  private disposed = false

  constructor(ctx: Context, config: VectorStoreConfig) {
    super(ctx, 'vectorstore')
    if (!config?.path || !isAbsolute(config.path)) throw new VectorStoreConfigError('vectorstore-lancedb: config.path must be an absolute directory')
    this.path = config.path
    this.ctx.effect(() => () => this.disposeAll())
  }

  async open(name: string, opts: OpenCollectionOptions): Promise<VectorStoreResult<{ collection: VectorCollection }>> {
    if (this.disposed) return fail('closed', 'the vector store has been disposed')
    if (typeof name !== 'string' || !NAME_RE.test(name)) return fail('input', 'collection name must be 1-64 characters of A-Z a-z 0-9 _ -')
    if (typeof opts?.fingerprint !== 'string' || opts.fingerprint.trim() === '') return fail('input', 'fingerprint is required')
    if (!Number.isInteger(opts.dimensions) || opts.dimensions < 1 || opts.dimensions > MAX_DIMENSIONS) return fail('input', `dimensions must be an integer from 1 to ${MAX_DIMENSIONS}`)

    let conn: LanceConn
    let lance: Lance
    try {
      lance = await this.loadLance()
    } catch (e) {
      return fail('unavailable', `could not load the native LanceDB module: ${msg(e)}`)
    }
    try {
      conn = await this.connect(lance)
    } catch (e) {
      return fail('io', `cannot open the database at ${this.path}: ${msg(e)}`)
    }

    try {
      const cached = this.collections.get(name)
      if (cached && opts.reset) {
        cached.close()
        this.collections.delete(name)
      }
      if (cached && !opts.reset) return this.checkOpen(cached, opts)

      const exists = (await conn.tableNames()).includes(name)
      if (exists && opts.reset) await conn.dropTable(name)

      if (exists && !opts.reset) {
        const table = await conn.openTable(name)
        const md = (await table.schema()).metadata
        const storedFp = md.get(META_FINGERPRINT)
        const storedDims = Number(md.get(META_DIMENSIONS))
        if (storedFp === undefined || !Number.isInteger(storedDims)) {
          table.close()
          return fail('corrupt', `table "${name}" exists but was not created by this store (no fingerprint recorded)`)
        }
        if (storedFp !== opts.fingerprint || storedDims !== opts.dimensions) {
          table.close()
          return fail('fingerprint_mismatch', `collection "${name}" was built with "${storedFp}" (${storedDims} dims), not "${opts.fingerprint}" (${opts.dimensions} dims); open it with reset: true to rebuild it`)
        }
        const col = new LanceCollection(name, storedFp, storedDims, table)
        this.collections.set(name, col)
        return { ok: true, collection: col }
      }

      const schema = new Schema(
        [
          new Field('id', new Utf8(), false),
          new Field('source', new Utf8(), true),
          new Field('metadata', new Utf8(), true),
          new Field('vector', new FixedSizeList(opts.dimensions, new Field('item', new Float32(), true)), false),
        ],
        new Map([[META_FINGERPRINT, opts.fingerprint], [META_DIMENSIONS, String(opts.dimensions)]]),
      )
      const table = await conn.createTable(name, [], { schema })
      const col = new LanceCollection(name, opts.fingerprint, opts.dimensions, table)
      this.collections.set(name, col)
      return { ok: true, collection: col }
    } catch (e) {
      return fail('io', msg(e))
    }
  }

  private checkOpen(col: LanceCollection, opts: OpenCollectionOptions): VectorStoreResult<{ collection: VectorCollection }> {
    if (col.fingerprint !== opts.fingerprint || col.dimensions !== opts.dimensions) {
      return fail('fingerprint_mismatch', `collection "${col.name}" is already open with "${col.fingerprint}" (${col.dimensions} dims), not "${opts.fingerprint}" (${opts.dimensions} dims)`)
    }
    return { ok: true, collection: col }
  }

  private loadLance(): Promise<Lance> {
    this.lance ??= import('@lancedb/lancedb').catch((e) => {
      this.lance = undefined
      throw e
    })
    return this.lance
  }

  private connect(lance: Lance): Promise<LanceConn> {
    this.conn ??= (async () => {
      mkdirSync(this.path, { recursive: true })
      return lance.connect(this.path)
    })().catch((e) => {
      this.conn = undefined
      throw e
    })
    return this.conn
  }

  private disposeAll(): void {
    this.disposed = true
    for (const c of this.collections.values()) c.close()
    this.collections.clear()
    const conn = this.conn
    this.conn = undefined
    conn?.then((c) => c.close()).catch(() => undefined)
  }
}

export const name = 'bundle-vectorstore-lancedb'

export function apply(ctx: Context, config: VectorStoreConfig): void {
  ctx.plugin(LanceVectorStore, config)
}
