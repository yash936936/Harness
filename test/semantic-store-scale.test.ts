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
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'harness-semantic-scale-'))
  dirs.push(dir)
  return dir
}

function fact(id: number): SemanticFact {
  return {
    tier: 'semantic',
    id: `scale-${String(id).padStart(6, '0')}`,
    text: `scale fixture fact ${id}`,
    why: 'Deterministic scale and recovery test fixture.',
    ts: timestamp,
  }
}

describe('semantic store scale and recovery', () => {
  it('rebuilds the compact identity sidecar after deletion-heavy writes when its manifest is missing', async () => {
    const dir = await fixture()
    const store = new SemanticFactStore(dir, 120_000)

    await store.withLock(async () => {
      for (let id = 0; id < 250; id += 1) await store.put(fact(id), limits)
      for (let id = 0; id < 150; id += 1) await store.delete(fact(id).id)
      expect(await store.count()).toBe(100)
    })

    await unlink(join(dir, 'semantic.index.meta.json'))
    const recovered = new SemanticFactStore(dir, 120_000)
    await recovered.withLock(async () => {
      expect(await recovered.count()).toBe(100)
      const page = await recovered.page(undefined, 100)
      expect(page.items).toHaveLength(100)
      expect(page.items[0]?.id).toBe('scale-000150')
      expect(page.items.at(-1)?.id).toBe('scale-000249')
    })
  }, 120_000)
})
