import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as lancedb from '@lancedb/lancedb'
import { Field, FixedSizeList, Float32, Schema, Utf8 } from 'apache-arrow'
import { Context } from 'cordis'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  LanceVectorStore,
  VectorStoreConfigError,
  type VectorCollection,
  type VectorStoreResult,
} from '../src/bundles/vectorstore-lancedb/index.js'

// Loading LanceDB's native module takes seconds on a cold machine; the first test must not time out on it.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

let base: string
let n = 0
beforeAll(async () => {
  await import('@lancedb/lancedb')
  base = realpathSync(mkdtempSync(join(tmpdir(), 'vs-')))
})
afterAll(() => rmSync(base, { recursive: true, force: true }))
const freshDir = () => join(base, `db${++n}`)

async function boot(path = freshDir()) {
  const ctx = new Context()
  const fiber = await ctx.plugin(LanceVectorStore, { path })
  return { ctx, fiber, store: ctx.vectorstore, path }
}
const FP = 'test:model-a:3'
async function collection(name = 'chunks', dims = 3, fp = FP, path?: string) {
  const b = await boot(path)
  const r = await b.store.open(name, { fingerprint: fp, dimensions: dims })
  return { ...b, col: ok(r).collection }
}

function ok<T extends object>(r: VectorStoreResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.kind}: ${r.error.detail}`)
  return r
}
const kind = (r: VectorStoreResult<object>) => (r.ok ? 'ok' : r.error.kind)
const ids = async (col: VectorCollection, v: number[], k = 50, source?: string) =>
  ok(await col.query(v, k, source === undefined ? {} : { source })).hits.map((h) => h.id)

describe('open', () => {
  it('creates a collection and reports its identity; the database directory is created', async () => {
    const { col } = await collection('chunks', 3, FP, join(freshDir(), 'nested', 'deeper'))
    expect([col.name, col.fingerprint, col.dimensions]).toEqual(['chunks', FP, 3])
    expect(ok(await col.count()).count).toBe(0)
  })

  it('rejects relative paths and bad names, fingerprints and dimensions', async () => {
    await expect(boot('relative/dir')).rejects.toBeInstanceOf(VectorStoreConfigError)
    const { store } = await boot()
    for (const name of ['', 'a b', 'a/b', '..', 'x'.repeat(65), 'é']) expect(kind(await store.open(name, { fingerprint: FP, dimensions: 3 })), name).toBe('input')
    expect(kind(await store.open('c', { fingerprint: '  ', dimensions: 3 }))).toBe('input')
    for (const dimensions of [0, -1, 1.5, 16385, NaN]) expect(kind(await store.open('c', { fingerprint: FP, dimensions })), String(dimensions)).toBe('input')
  })

  it('opening the same collection twice in one store returns the same working collection', async () => {
    const { store, col } = await collection()
    const again = ok(await store.open('chunks', { fingerprint: FP, dimensions: 3 })).collection
    expect(again).toBe(col)
  })

  it('collections are isolated from each other', async () => {
    const { store, col } = await collection('one')
    const two = ok(await store.open('two', { fingerprint: FP, dimensions: 3 })).collection
    ok(await col.upsert([{ id: 'a', vector: [1, 0, 0] }]))
    expect(ok(await two.count()).count).toBe(0)
    expect(await ids(two, [1, 0, 0])).toEqual([])
  })
})

describe('upsert and query', () => {
  it('returns the nearest first with cosine similarity scores', async () => {
    const { col } = await collection()
    ok(await col.upsert([
      { id: 'same', vector: [1, 0, 0] },
      { id: 'close', vector: [0.9, 0.1, 0] },
      { id: 'orthogonal', vector: [0, 1, 0] },
      { id: 'opposite', vector: [-1, 0, 0] },
    ]))
    const hits = ok(await col.query([1, 0, 0], 4)).hits
    expect(hits.map((h) => h.id)).toEqual(['same', 'close', 'orthogonal', 'opposite'])
    expect(hits[0]!.score).toBeCloseTo(1, 5)
    expect(hits[1]!.score).toBeCloseTo(0.9 / Math.hypot(0.9, 0.1), 4)
    expect(hits[2]!.score).toBeCloseTo(0, 5)
    expect(hits[3]!.score).toBeCloseTo(-1, 5)
  })

  it('scores never leave [-1, 1]: LanceDB itself returns 1.0000001 for an identical vector', async () => {
    const { col } = await collection('big', 64, 'test:model-a:64')
    let seed = 12345
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1
    const vecs = Array.from({ length: 200 }, () => Array.from({ length: 64 }, rnd))
    ok(await col.upsert(vecs.map((v, i) => ({ id: `v${i}`, vector: v }))))
    let selfHits = 0
    for (const v of vecs) {
      const hits = ok(await col.query(v, 3)).hits
      for (const h of hits) { expect(h.score).toBeLessThanOrEqual(1); expect(h.score).toBeGreaterThanOrEqual(-1) }
      if (hits[0]!.score > 0.999999) selfHits++
      const anti = ok(await col.query(v.map((x) => -x), 1)).hits
      expect(anti[0]!.score).toBeGreaterThanOrEqual(-1)
    }
    expect(selfHits).toBe(200) // each vector's own nearest neighbour is itself
  })

  it('scale does not matter (cosine, not distance): [10,0,0] is as close as [1,0,0]', async () => {
    const { col } = await collection()
    ok(await col.upsert([{ id: 'big', vector: [10, 0, 0] }, { id: 'small', vector: [0.001, 0.001, 0] }]))
    const hits = ok(await col.query([1, 0, 0], 2)).hits
    expect(hits[0]!.id).toBe('big')
    expect(hits[0]!.score).toBeCloseTo(1, 5)
  })

  it('writing an existing id replaces it (vector, source and metadata) without adding a row', async () => {
    const { col } = await collection()
    ok(await col.upsert([{ id: 'a', vector: [1, 0, 0], source: 'old.ts', metadata: { v: 1 } }]))
    ok(await col.upsert([{ id: 'a', vector: [0, 1, 0], source: 'new.ts', metadata: { v: 2 } }]))
    expect(ok(await col.count()).count).toBe(1)
    const [hit] = ok(await col.query([0, 1, 0], 1)).hits
    expect(hit).toMatchObject({ id: 'a', source: 'new.ts', metadata: { v: 2 } })
    expect(hit!.score).toBeCloseTo(1, 5)
  })

  it('a duplicate id inside one batch keeps the last and stores ONE row', async () => {
    const { col } = await collection()
    const r = ok(await col.upsert([
      { id: 'dup', vector: [1, 0, 0], source: 'first' },
      { id: 'other', vector: [0, 0, 1] },
      { id: 'dup', vector: [0, 1, 0], source: 'last' },
    ]))
    expect(r.written).toBe(2)
    expect(ok(await col.count()).count).toBe(2)
    expect(ok(await col.query([0, 1, 0], 1)).hits[0]).toMatchObject({ id: 'dup', source: 'last' })
  })

  it('round-trips metadata (nested, unicode) and omits it when absent', async () => {
    const { col } = await collection()
    const metadata = { lines: [10, 42], symbol: 'Foo.bar', nested: { ok: true, s: 'héllo 日本語 😀' } }
    ok(await col.upsert([{ id: 'a', vector: [1, 0, 0], metadata }, { id: 'b', vector: [0, 1, 0] }]))
    const hits = ok(await col.query([1, 0, 0], 2)).hits
    expect(hits.find((h) => h.id === 'a')!.metadata).toEqual(metadata)
    const b = hits.find((h) => h.id === 'b')!
    expect(b.metadata).toBeUndefined()
    expect(b.source).toBeUndefined()
  })

  it('hits carry no raw vectors (memory) and only the documented fields', async () => {
    const { col } = await collection()
    ok(await col.upsert([{ id: 'a', vector: [1, 0, 0], source: 's', metadata: { x: 1 } }]))
    expect(Object.keys(ok(await col.query([1, 0, 0], 1)).hits[0]!).sort()).toEqual(['id', 'metadata', 'score', 'source'])
  })

  it('asking for more than exist returns them all; an empty collection returns nothing', async () => {
    const { col } = await collection()
    expect(await ids(col, [1, 0, 0], 10)).toEqual([])
    ok(await col.upsert([{ id: 'a', vector: [1, 0, 0] }, { id: 'b', vector: [0, 1, 0] }]))
    expect(await ids(col, [1, 0, 0], 10)).toEqual(['a', 'b'])
    expect(await ids(col, [1, 0, 0], 1)).toEqual(['a'])
  })

  it('ties are broken by id, so results are deterministic', async () => {
    const { col } = await collection()
    ok(await col.upsert([{ id: 'zz', vector: [1, 0, 0] }, { id: 'mm', vector: [1, 0, 0] }, { id: 'aa', vector: [1, 0, 0] }]))
    expect(await ids(col, [1, 0, 0], 3)).toEqual(['aa', 'mm', 'zz'])
  })

  it('an empty upsert is a no-op', async () => {
    const { col } = await collection()
    expect(ok(await col.upsert([])).written).toBe(0)
  })

  it('handles a large batch (2500 records) and finds a specific one', async () => {
    const { col } = await collection()
    const recs = Array.from({ length: 2500 }, (_, i) => ({ id: `id${i}`, vector: [Math.cos(i), Math.sin(i), 1 + (i % 7)], source: `file${i % 50}.ts` }))
    expect(ok(await col.upsert(recs)).written).toBe(2500)
    expect(ok(await col.count()).count).toBe(2500)
    expect((await ids(col, recs[1234]!.vector, 1))[0]).toBe('id1234')
  })

  it('concurrent upserts of the same id apply in call order: the last call wins', async () => {
    const { col } = await collection()
    await Promise.all(Array.from({ length: 12 }, (_, i) => col.upsert([{ id: 'same', vector: [1, i + 1, 0], source: `s${i}` }])))
    expect(ok(await col.count()).count).toBe(1)
    expect(ok(await col.query([1, 12, 0], 1)).hits[0]).toMatchObject({ id: 'same', source: 's11' })
  })
})

describe('source filtering and deletion', () => {
  const seed = async (col: VectorCollection) => ok(await col.upsert([
    { id: 'a1', vector: [1, 0, 0], source: 'a.ts' },
    { id: 'a2', vector: [0.9, 0.1, 0], source: 'a.ts' },
    { id: 'b1', vector: [1, 0.1, 0], source: 'b.ts' },
    { id: 'n1', vector: [0.8, 0.2, 0] },
  ]))

  it('a query can be restricted to one source (with the unfiltered query as positive control)', async () => {
    const { col } = await collection()
    await seed(col)
    expect(await ids(col, [1, 0, 0])).toEqual(expect.arrayContaining(['a1', 'a2', 'b1', 'n1']))
    expect(await ids(col, [1, 0, 0], 50, 'a.ts')).toEqual(['a1', 'a2'])
    expect(await ids(col, [1, 0, 0], 50, 'nope.ts')).toEqual([])
  })

  it('deleteSource removes exactly that source and reports how many', async () => {
    const { col } = await collection()
    await seed(col)
    expect(ok(await col.deleteSource('a.ts')).deleted).toBe(2)
    expect(ok(await col.count()).count).toBe(2)
    expect(await ids(col, [1, 0, 0])).toEqual(expect.arrayContaining(['b1', 'n1']))
    expect(await ids(col, [1, 0, 0])).not.toContain('a1')
    expect(ok(await col.deleteSource('a.ts')).deleted).toBe(0)
  })

  it('deleteIds removes the listed ids, ignores unknown ones, and counts correctly', async () => {
    const { col } = await collection()
    await seed(col)
    expect(ok(await col.deleteIds(['a1', 'ghost', 'a1'])).deleted).toBe(1)
    expect(ok(await col.count()).count).toBe(3)
    expect(ok(await col.deleteIds([])).deleted).toBe(0)
  })

  it('deleting a large list of ids works', async () => {
    const { col } = await collection()
    const recs = Array.from({ length: 1200 }, (_, i) => ({ id: `k${i}`, vector: [1, i + 1, 0] }))
    ok(await col.upsert(recs))
    expect(ok(await col.deleteIds(recs.map((r) => r.id))).deleted).toBe(1200)
    expect(ok(await col.count()).count).toBe(0)
  })

  it('quotes, backslashes, newlines, double quotes and unicode in ids and sources are handled literally', async () => {
    const { col } = await collection()
    const weird = ["it's.ts", 'say "hi".ts', 'back\\slash.ts', 'new\nline.ts', 'ünï 日本 😀.ts', "'; DROP TABLE x; --", "a' OR '1'='1"]
    ok(await col.upsert([
      ...weird.map((w, i) => ({ id: `id-${w}`, vector: [1, i + 1, 0], source: w })),
      { id: 'innocent', vector: [1, 0, 0], source: 'innocent.ts' },
    ]))
    expect(ok(await col.count()).count).toBe(weird.length + 1)
    for (const w of weird) {
      expect(await ids(col, [1, 0, 0], 50, w), `query ${w}`).toEqual([`id-${w}`])
      expect(ok(await col.deleteSource(w)).deleted, `deleteSource ${w}`).toBe(1)
    }
    expect(ok(await col.count()).count).toBe(1) // the injection-looking values deleted only themselves
    ok(await col.upsert([{ id: "o'brien \"x\"", vector: [0, 0, 1] }]))
    expect(ok(await col.deleteIds(["o'brien \"x\""])).deleted).toBe(1)
    expect(ok(await col.count()).count).toBe(1)
  })
})

describe('validation', () => {
  it('a wrong-length vector is refused, and NOTHING from that batch is written (LanceDB itself would store it)', async () => {
    const { col } = await collection()
    const r = await col.upsert([{ id: 'good', vector: [1, 0, 0] }, { id: 'bad', vector: [1, 0] }])
    expect(kind(r)).toBe('dimension_mismatch')
    expect(ok(await col.count()).count).toBe(0)
    expect(kind(await col.upsert([{ id: 'long', vector: [1, 0, 0, 0] }]))).toBe('dimension_mismatch')
    expect(ok(await col.count()).count).toBe(0)
  })

  it('NaN, Infinity and all-zero vectors are refused (for records and queries)', async () => {
    const { col } = await collection()
    for (const vector of [[NaN, 0, 0], [Infinity, 0, 0], [0, 0, 0]]) {
      expect(kind(await col.upsert([{ id: 'x', vector }])), String(vector)).toBe('input')
      expect(kind(await col.query(vector, 1)), String(vector)).toBe('input')
    }
    expect(ok(await col.count()).count).toBe(0)
  })

  it('a query vector of the wrong length is a dimension_mismatch', async () => {
    const { col } = await collection()
    expect(kind(await col.query([1, 0], 1))).toBe('dimension_mismatch')
  })

  it('validates ids, sources, metadata and k', async () => {
    const { col } = await collection()
    const v = [1, 0, 0]
    expect(kind(await col.upsert([{ id: '', vector: v }]))).toBe('input')
    expect(kind(await col.upsert([{ id: 'x'.repeat(513), vector: v }]))).toBe('input')
    expect(kind(await col.upsert([{ id: 'a\0b', vector: v }]))).toBe('input')
    expect(kind(await col.upsert([{ id: 5 as unknown as string, vector: v }]))).toBe('input')
    expect(kind(await col.upsert([{ id: 'a', vector: v, source: '' }]))).toBe('input')
    expect(kind(await col.upsert([{ id: 'a', vector: v, source: 'x'.repeat(1025) }]))).toBe('input')
    expect(kind(await col.upsert([{ id: 'a', vector: v, metadata: [] as unknown as Record<string, unknown> }]))).toBe('input')
    expect(kind(await col.upsert([{ id: 'a', vector: v, metadata: { big: 'x'.repeat(70_000) } }]))).toBe('input')
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    expect(kind(await col.upsert([{ id: 'a', vector: v, metadata: circular }]))).toBe('input')
    for (const k of [0, -1, 1.5, 1001, NaN]) expect(kind(await col.query(v, k)), String(k)).toBe('input')
    expect(kind(await col.query(v, 1, { source: '' }))).toBe('input')
    expect(kind(await col.deleteSource(''))).toBe('input')
    expect(kind(await col.deleteIds(['ok', '']))).toBe('input')
    expect(ok(await col.count()).count).toBe(0)
  })
})

describe('persistence and the embedding fingerprint', () => {
  it('data survives disposing the plugin and reopening the same directory', async () => {
    const path = freshDir()
    const first = await collection('chunks', 3, FP, path)
    ok(await first.col.upsert([{ id: 'a', vector: [1, 0, 0], source: 's.ts', metadata: { l: 1 } }, { id: 'b', vector: [0, 1, 0] }]))
    await first.fiber.dispose()

    const second = await collection('chunks', 3, FP, path)
    expect(ok(await second.col.count()).count).toBe(2)
    expect(ok(await second.col.query([1, 0, 0], 1)).hits[0]).toMatchObject({ id: 'a', source: 's.ts', metadata: { l: 1 } })
    ok(await second.col.upsert([{ id: 'c', vector: [0, 0, 1] }]))
    expect(ok(await second.col.count()).count).toBe(3)
  })

  it('reopening with a different fingerprint or dimensions is refused and the data is untouched', async () => {
    const path = freshDir()
    const first = await collection('chunks', 3, FP, path)
    ok(await first.col.upsert([{ id: 'a', vector: [1, 0, 0] }]))
    await first.fiber.dispose()

    const b = await boot(path)
    const wrongModel = await b.store.open('chunks', { fingerprint: 'test:model-b:3', dimensions: 3 })
    expect(kind(wrongModel)).toBe('fingerprint_mismatch')
    expect(!wrongModel.ok && wrongModel.error.detail).toContain('reset: true')
    expect(kind(await b.store.open('chunks', { fingerprint: FP, dimensions: 4 }))).toBe('fingerprint_mismatch')
    const right = ok(await b.store.open('chunks', { fingerprint: FP, dimensions: 3 })).collection
    expect(ok(await right.count()).count).toBe(1)
  })

  it('the same collection already open in this store also refuses a different fingerprint', async () => {
    const { store } = await collection()
    expect(kind(await store.open('chunks', { fingerprint: 'other', dimensions: 3 }))).toBe('fingerprint_mismatch')
  })

  it('reset: true drops the old data and starts a new collection with the new identity', async () => {
    const path = freshDir()
    const first = await collection('chunks', 3, FP, path)
    ok(await first.col.upsert([{ id: 'a', vector: [1, 0, 0] }]))
    const fresh = ok(await first.store.open('chunks', { fingerprint: 'test:model-b:5', dimensions: 5, reset: true })).collection
    expect(fresh.dimensions).toBe(5)
    expect(ok(await fresh.count()).count).toBe(0)
    ok(await fresh.upsert([{ id: 'n', vector: [1, 0, 0, 0, 0] }]))
    // the previous handle is closed, not silently writing into the new table with the wrong dimensions
    expect(kind(await first.col.upsert([{ id: 'x', vector: [1, 0, 0] }]))).toBe('closed')
    await first.fiber.dispose()
    const again = await collection('chunks', 5, 'test:model-b:5', path)
    expect(ok(await again.col.count()).count).toBe(1)
  })

  it('reset on a name that does not exist just creates it', async () => {
    const { store } = await boot()
    const c = ok(await store.open('new', { fingerprint: FP, dimensions: 3, reset: true })).collection
    expect(ok(await c.count()).count).toBe(0)
  })

  it('a table this store did not create is reported as corrupt, not overwritten', async () => {
    const path = freshDir()
    mkdirSync(path, { recursive: true })
    const db = await lancedb.connect(path)
    const schema = new Schema([new Field('id', new Utf8(), false), new Field('vector', new FixedSizeList(3, new Field('item', new Float32(), true)), false)])
    const t = await db.createTable('foreign', [], { schema })
    await t.add([{ id: 'x', vector: Float32Array.from([1, 2, 3]) }])
    t.close()
    db.close()
    const { store } = await boot(path)
    expect(kind(await store.open('foreign', { fingerprint: FP, dimensions: 3 }))).toBe('corrupt')
    const db2 = await lancedb.connect(path)
    expect(await (await db2.openTable('foreign')).countRows()).toBe(1)
    db2.close()
  })
})

describe('lifecycle', () => {
  it('after the plugin is disposed, collections and the store report closed instead of throwing', async () => {
    const { col, store, fiber } = await collection()
    ok(await col.upsert([{ id: 'a', vector: [1, 0, 0] }]))
    await fiber.dispose()
    expect(kind(await col.count())).toBe('closed')
    expect(kind(await col.upsert([{ id: 'b', vector: [1, 0, 0] }]))).toBe('closed')
    expect(kind(await col.query([1, 0, 0], 1))).toBe('closed')
    expect(kind(await col.deleteIds(['a']))).toBe('closed')
    expect(kind(await col.deleteSource('a'))).toBe('closed')
    expect(kind(await store.open('again', { fingerprint: FP, dimensions: 3 }))).toBe('closed')
    // closed wins over input validation: a closed collection never looks at its arguments
    expect(kind(await col.upsert([{ id: '', vector: [] }]))).toBe('closed')
    expect(kind(await col.query([], 0))).toBe('closed')
  })

  it('a database directory that cannot be created is an io error, not an exception', async () => {
    const { store } = await boot(join(base, 'file-in-the-way', 'db'))
    // make "file-in-the-way" a FILE so mkdir of a child fails
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(base, 'file-in-the-way'), 'x')
    expect(kind(await store.open('c', { fingerprint: FP, dimensions: 3 }))).toBe('io')
  })
})
