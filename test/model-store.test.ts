import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { ModelStore, ModelStoreError, sha256Hex, type ModelRecord } from '../src/bundles/model-store/index.js'

const REVISION_A = 'a'.repeat(64)
const REVISION_B = 'b'.repeat(64)

function record(over: Partial<ModelRecord> = {}): ModelRecord {
  return { id: 'model-a', source: 'ollama-library', revision: 'v1', sha256: REVISION_A, license: 'MIT', ...over }
}

async function boot(): Promise<ModelStore> {
  const ctx = new Context()
  await ctx.plugin(ModelStore, {})
  return ctx.modelStore
}

describe('ModelStore.register', () => {
  it('accepts every allowlisted source', async () => {
    const store = await boot()
    store.register(record({ id: 'm1', source: 'ollama-library' }))
    store.register(record({ id: 'm2', source: 'ornith-ai' }))
    store.register(record({ id: 'm3', source: 'cactus-compute' }))
    expect(store.list().map((m) => m.id).sort()).toEqual(['m1', 'm2', 'm3'])
  })

  it('rejects a source outside the allowlist, naming it and the allowed set', async () => {
    const store = await boot()
    try {
      // @ts-expect-error - deliberately outside the ModelSource union
      store.register(record({ source: 'random-github-fork' }))
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ModelStoreError)
      expect((e as ModelStoreError).kind).toBe('unallowlisted_source')
      expect((e as Error).message).toContain('random-github-fork')
      expect((e as Error).message).toContain('ollama-library')
    }
    expect(store.list()).toEqual([]) // the rejected record was never partially stored
  })

  it('rejects a duplicate id - re-pinning under the same id is refused, not silently overwritten', async () => {
    const store = await boot()
    store.register(record({ id: 'dup', revision: 'v1' }))
    expect(() => store.register(record({ id: 'dup', revision: 'v2' }))).toThrowError(
      expect.objectContaining({ kind: 'duplicate' }),
    )
    expect(store.get('dup')?.revision).toBe('v1') // the original registration is untouched
  })

  it('lowercases the stored digest regardless of the case it was registered in', async () => {
    const store = await boot()
    store.register(record({ id: 'm', sha256: REVISION_A.toUpperCase() }))
    expect(store.get('m')?.sha256).toBe(REVISION_A)
  })
})

describe('ModelStore.verifyDigest', () => {
  it('passes on a matching digest, case-insensitively on both sides', async () => {
    const store = await boot()
    store.register(record({ id: 'm', sha256: REVISION_A }))
    expect(() => store.verifyDigest('m', REVISION_A)).not.toThrow()
    expect(() => store.verifyDigest('m', REVISION_A.toUpperCase())).not.toThrow()
  })

  it('throws digest_mismatch on any mismatch, naming both the pinned and the actual digest', async () => {
    const store = await boot()
    store.register(record({ id: 'm', sha256: REVISION_A }))
    try {
      store.verifyDigest('m', REVISION_B)
      expect.unreachable()
    } catch (e) {
      expect((e as ModelStoreError).kind).toBe('digest_mismatch')
      expect((e as Error).message).toContain(REVISION_A)
      expect((e as Error).message).toContain(REVISION_B)
    }
  })

  it('throws unknown_model for an id that was never registered', async () => {
    const store = await boot()
    expect(() => store.verifyDigest('nope', REVISION_A)).toThrowError(expect.objectContaining({ kind: 'unknown_model' }))
  })
})

describe('sha256Hex', () => {
  it('matches real, independently-computed SHA-256 values', () => {
    // Computed with node:crypto directly, not recalled from memory - see docs/debug.md.
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('hello-world')).toBe('afa27b44d43b02a9fea41d13cedc2e4016cfcf87c5dbf990e593669aa8ce286d')
  })
})

describe('ModelStore.resolve / resolveAll', () => {
  it('resolves to the pin when the pin is registered, even if fallbacks are also registered', async () => {
    const store = await boot()
    store.register(record({ id: 'pin' }))
    store.register(record({ id: 'fallback' }))
    store.setBinding({ name: 'worker', pinnedModelId: 'pin', fallbackIds: ['fallback'] })
    expect(store.resolve('worker')).toEqual({ bindingName: 'worker', resolvedId: 'pin', usedPin: true, unavailable: false })
  })

  it('falls through to the first registered fallback, in order, when the pin is missing', async () => {
    const store = await boot()
    store.register(record({ id: 'fallback-2' }))
    store.setBinding({ name: 'worker', pinnedModelId: 'missing-pin', fallbackIds: ['fallback-1', 'fallback-2'] })
    expect(store.resolve('worker')).toEqual({ bindingName: 'worker', resolvedId: 'fallback-2', usedPin: false, unavailable: false })
  })

  it('is unavailable when neither the pin nor any fallback is registered', async () => {
    const store = await boot()
    store.setBinding({ name: 'worker', pinnedModelId: 'missing', fallbackIds: ['also-missing'] })
    expect(store.resolve('worker')).toEqual({ bindingName: 'worker', usedPin: false, unavailable: true })
  })

  it('is unavailable for a binding that was never set at all - not an error, not a crash', async () => {
    const store = await boot()
    expect(store.resolve('never-configured')).toEqual({ bindingName: 'never-configured', usedPin: false, unavailable: true })
  })

  it('resolveAll reports every set binding', async () => {
    const store = await boot()
    store.register(record({ id: 'a' }))
    store.setBinding({ name: 'worker', pinnedModelId: 'a', fallbackIds: [] })
    store.setBinding({ name: 'router', pinnedModelId: 'missing', fallbackIds: [] })
    const all = store.resolveAll()
    expect(all.find((a) => a.bindingName === 'worker')).toMatchObject({ resolvedId: 'a', unavailable: false })
    expect(all.find((a) => a.bindingName === 'router')).toMatchObject({ unavailable: true })
  })
})

describe('ModelStore boot config', () => {
  it('seeds models and bindings at boot, applying the same validation as register()', async () => {
    const ctx = new Context()
    await ctx.plugin(ModelStore, {
      models: [record({ id: 'seeded' })],
      bindings: [{ name: 'worker', pinnedModelId: 'seeded', fallbackIds: [] }],
    })
    expect(ctx.modelStore.resolve('worker')).toMatchObject({ resolvedId: 'seeded', unavailable: false })
  })

  it('a bad seed record throws at boot, not silently', async () => {
    const ctx = new Context()
    // @ts-expect-error - deliberately outside the ModelSource union
    await expect(ctx.plugin(ModelStore, { models: [record({ source: 'not-allowlisted' })] })).rejects.toThrow(ModelStoreError)
  })
})

describe('sha256File / verifyFile', () => {
  it('hashes a real file to the same value as hashing its bytes, and verifyFile enforces the pin', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { sha256File } = await import('../src/bundles/model-store/index.js')
    const dir = await mkdtemp(join(tmpdir(), 'model-store-'))
    try {
      const path = join(dir, 'blob')
      await writeFile(path, 'hello-world')
      expect(await sha256File(path)).toBe('afa27b44d43b02a9fea41d13cedc2e4016cfcf87c5dbf990e593669aa8ce286d')

      const store = await boot()
      store.register(record({ id: 'm', sha256: 'afa27b44d43b02a9fea41d13cedc2e4016cfcf87c5dbf990e593669aa8ce286d' }))
      store.register(record({ id: 'other', sha256: REVISION_A }))
      await expect(store.verifyFile('m', path)).resolves.toBeUndefined()
      await expect(store.verifyFile('other', path)).rejects.toMatchObject({ kind: 'digest_mismatch' })
      await expect(sha256File(join(dir, 'missing'))).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('REFERENCE_WORKER_PIN (real data from the owner\'s machine, D-042)', () => {
  it('registers cleanly, has well-formed digests, and the blob hash matches the filename Ollama reported', async () => {
    const { REFERENCE_WORKER_PIN, REFERENCE_WORKER_BINDING } = await import('../src/bundles/model-store/index.js')
    const store = await boot()
    store.register(REFERENCE_WORKER_PIN)
    store.setBinding(REFERENCE_WORKER_BINDING)
    expect(store.resolve('worker')).toMatchObject({ resolvedId: 'qwen2.5-coder:3b-instruct', usedPin: true })
    expect(REFERENCE_WORKER_PIN.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(REFERENCE_WORKER_PIN.sourceDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(REFERENCE_WORKER_PIN.sha256).not.toBe(REFERENCE_WORKER_PIN.sourceDigest) // two different digests, kept apart
    expect(REFERENCE_WORKER_PIN.sha256.startsWith('4a188102020e')).toBe(true) // the prefix Ollama printed while verifying the pull
    expect(REFERENCE_WORKER_PIN.sourceDigest!.startsWith('f72c60cabf62')).toBe(true) // the ID column of `ollama list`
    expect(REFERENCE_WORKER_PIN.license).toMatch(/non-commercial/i)
  })
})

describe('NEEDLE_PIN (real data from the owner\'s machine, D-049)', () => {
  it('registers cleanly with a well-formed digest and revision, and is not an ollama-checked record', async () => {
    const { NEEDLE_PIN } = await import('../src/bundles/model-store/index.js')
    const store = await boot()
    store.register(NEEDLE_PIN)
    expect(NEEDLE_PIN.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(NEEDLE_PIN.sha256.startsWith('b43aabfcaf1a')).toBe(true)
    expect(NEEDLE_PIN.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(NEEDLE_PIN.license).toBe('Apache-2.0')
    expect(store.checkInstalled([{ name: 'needle2', digest: 'x' }]).find((c) => c.id === 'needle2')).toBeUndefined()
  })
})

describe('ModelStore.checkInstalled (D-043)', () => {
  const PIN = 'f'.repeat(64)
  async function withPin() {
    const store = await boot()
    store.register(record({ id: 'tag:1b', sha256: REVISION_A, sourceDigest: PIN }))
    store.register(record({ id: 'no-source-digest', sha256: REVISION_B }))
    store.register(record({ id: 'not-ollama', source: 'cactus-compute', sha256: REVISION_B, sourceDigest: PIN }))
    return store
  }
  it('reports matches_pin / differs_from_pin / not_installed / unchecked, only for ollama-library records', async () => {
    const store = await withPin()
    const of = (installed: Array<{ name: string; digest?: string }>) => Object.fromEntries(store.checkInstalled(installed).map((c) => [c.id, c.status]))
    expect(of([{ name: 'tag:1b', digest: PIN.toUpperCase() }, { name: 'no-source-digest', digest: PIN }])).toEqual({ 'tag:1b': 'matches_pin', 'no-source-digest': 'unchecked' })
    expect(of([{ name: 'tag:1b', digest: 'e'.repeat(64) }])['tag:1b']).toBe('differs_from_pin')
    expect(of([])['tag:1b']).toBe('not_installed')
    expect(of([{ name: 'tag:1b' }])['tag:1b']).toBe('unchecked') // host reported no digest
    expect('not-ollama' in of([])).toBe(false)
  })
})
