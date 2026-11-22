import { mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SemanticFactStore } from '../src/bundles/memory/semantic-store.js'
import type { SemanticFact } from '../src/bundles/memory/types.js'

const dirs: string[] = []
const limits = { maxFacts: 5_000, maxFactBytes: 16_384 }
const timestamp = '2026-11-23T00:00:00.000Z'

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'harness-semantic-scale-'))
  dirs.push(dir)
  return dir
}

function fact(id: number, text = `scale fixture fact ${id}`): SemanticFact {
  return {
    tier: 'semantic',
    id: `scale-${String(id).padStart(6, '0')}`,
    text,
    why: 'Deterministic scale and recovery test fixture.',
    ts: timestamp,
  }
}

describe('semantic store scale and cross-instance recovery', () => {
  it('serializes concurrent writers, survives deletion-heavy rebuild, and invalidates stale cursors', async () => {
    const dir = await fixture()
    const writers = Array.from({ length: 4 }, () => new SemanticFactStore(dir))

    await Promise.all(writers.map(async (store, worker) => {
      for (let index = 0; index < 250; index += 1) {
        const id = worker * 250 + index
        await store.withLock(async () => { await store.put(fact(id), limits) })
      }
    }))

    const beforeDeletes = new SemanticFactStore(dir)
    await beforeDeletes.withLock(async () => {
      expect(await beforeDeletes.count()).toBe(1_000)
    })
    const firstPage = await beforeDeletes.page(undefined, 100)
    expect(firstPage.items).toHaveLength(100)

    await Promise.all(writers.map(async (store, worker) => {
      for (let index = 0; index < 125; index += 1) {
        const id = worker * 250 + index
        await store.withLock(async () => { await store.delete(fact(id).id) })
      }
    }))

    const restarted = new SemanticFactStore(dir)
    await restarted.withLock(async () => {
      expect(await restarted.count()).toBe(500)
      const page = await restarted.page(undefined, 100)
      expect(page.items).toHaveLength(100)
      expect(page.items[0]?.id).toBe('scale-000125')
      expect(page.items.at(-1)?.id).toBe('scale-000224')
    })

    await restarted.withLock(async () => { await restarted.put(fact(2_000), limits) })
    await expect(restarted.page(firstPage.items.at(-1)?.id, 100, firstPage.sourceBytes))
      .rejects.toThrow(/source changed/)
  })

  it('rebuilds a compact identity sidecar after restart when its manifest is missing', async () => {
    const dir = await fixture()
    const store = new SemanticFactStore(dir)
    for (let id = 0; id < 2_000; id += 1) {
      await store.withLock(async () => { await store.put(fact(id), limits) })
    }
    for (let id = 0; id < 1_500; id += 1) {
      await store.withLock(async () => { await store.delete(fact(id).id) })
    }

    await unlink(join(dir, 'semantic.index.meta.json'))
    const recovered = new SemanticFactStore(dir)
    await recovered.withLock(async () => {
      expect(await recovered.count()).toBe(500)
      const tail = await recovered.page('scale-001998', 10)
      expect(tail.items.map((item) => item.id)).toEqual(['scale-001999'])
    })
  })
})
