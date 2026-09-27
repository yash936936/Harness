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
