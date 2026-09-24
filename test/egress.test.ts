import { Context } from 'cordis'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EgressError, EgressPolicy, FileConsentStore, MemoryConsentStore, type EgressConfig } from '../src/bundles/egress/index.js'

describe('egress: consent stores', () => {
  it('MemoryConsentStore: no record until set, does not survive a new instance', async () => {
    const store = new MemoryConsentStore()
    expect(await store.get('p1')).toBeUndefined()
    await store.set({ projectId: 'p1', consented: true, decidedAt: 'now' })
    expect(await store.get('p1')).toMatchObject({ consented: true })
    expect(await new MemoryConsentStore().get('p1')).toBeUndefined()
  })

  describe('FileConsentStore', () => {
    let dir: string
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'egress-test-'))
    })
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true })
    })

    it('persists a consent record to a fresh file, creating parent directories', async () => {
      const path = join(dir, 'nested', 'consent.json')
      const store = new FileConsentStore(path)
      expect(await store.get('proj')).toBeUndefined()
      await store.set({ projectId: 'proj', consented: true, decidedAt: '2026-01-01T00:00:00.000Z' })
      const onDisk = JSON.parse(await readFile(path, 'utf8'))
      expect(onDisk).toMatchObject({ proj: { consented: true } })
    })

    it('a fresh FileConsentStore pointed at the same path reads what an earlier one wrote (the actual "survives restart" property)', async () => {
      const path = join(dir, 'consent.json')
      await new FileConsentStore(path).set({ projectId: 'proj', consented: true, decidedAt: 'x' })
      const reopened = new FileConsentStore(path)
      expect(await reopened.get('proj')).toMatchObject({ projectId: 'proj', consented: true })
    })

    it('keeps other projects intact when one project is updated', async () => {
      const path = join(dir, 'consent.json')
      const store = new FileConsentStore(path)
      await store.set({ projectId: 'a', consented: true, decidedAt: 'x' })
      await store.set({ projectId: 'b', consented: false, decidedAt: 'y' })
      expect(await store.get('a')).toMatchObject({ consented: true })
      expect(await store.get('b')).toMatchObject({ consented: false })
    })
  })
})

async function bootPolicy(config: Partial<EgressConfig> = {}) {
  const ctx = new Context()
  await ctx.plugin(EgressPolicy, { projectId: 'test', ...config })
  return ctx
}

describe('egress: EgressPolicy', () => {
  it('requires projectId', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(EgressPolicy, {} as any)).rejects.toThrow(EgressError)
  })

  it('hasConsent is false with no record, true after grantConsent, false again after revokeConsent', async () => {
    const ctx = await bootPolicy()
    expect(await ctx.egress.hasConsent()).toBe(false)
    await ctx.egress.grantConsent()
    expect(await ctx.egress.hasConsent()).toBe(true)
    await ctx.egress.revokeConsent()
    expect(await ctx.egress.hasConsent()).toBe(false)
  })

  it('consent is tracked per project, not globally: a different projectId has its own record', async () => {
    const { MemoryConsentStore: Store } = await import('../src/bundles/egress/index.js')
    const shared = new Store()
    const ctxA = new Context()
    await ctxA.plugin(EgressPolicy, { projectId: 'a', consentStore: shared })
    await ctxA.egress.grantConsent()
    const ctxB = new Context()
    await ctxB.plugin(EgressPolicy, { projectId: 'b', consentStore: shared })
    expect(await ctxB.egress.hasConsent()).toBe(false)
  })

  it('allowlist: empty by default (nothing allowed), exact-match only', async () => {
    const ctx = await bootPolicy({ allowedHosts: ['api.example.com'] })
    expect(ctx.egress.isAllowedHost('api.example.com')).toBe(true)
    expect(ctx.egress.isAllowedHost('evil.example.com')).toBe(false)
    expect(() => ctx.egress.assertAllowedHost('evil.example.com')).toThrow(EgressError)
    expect(() => ctx.egress.assertAllowedHost('api.example.com')).not.toThrow()
  })

  it('with no allowedHosts configured, every host is refused', async () => {
    const ctx = await bootPolicy()
    expect(ctx.egress.isAllowedHost('anything.com')).toBe(false)
  })

  describe('redaction', () => {
    it('redact() replaces every occurrence of a registered secret value with a named marker', async () => {
      const ctx = await bootPolicy({ secrets: { apiKey: 'sk-FAKESECRET123' } })
      expect(ctx.egress.redact('key=sk-FAKESECRET123 and again sk-FAKESECRET123')).toBe(
        'key=[redacted:apiKey] and again [redacted:apiKey]',
      )
    })

    it('registerSecret() adds a secret after boot; an empty/undefined value is a no-op', async () => {
      const ctx = await bootPolicy()
      ctx.egress.registerSecret('later', 'shh-do-not-leak')
      ctx.egress.registerSecret('empty', undefined)
      expect(ctx.egress.redact('token shh-do-not-leak here')).toBe('token [redacted:later] here')
      expect(ctx.egress.redact('nothing to see')).toBe('nothing to see')
    })

    it('redactValue() walks nested objects/arrays and redacts every string leaf, leaving structure and non-string values intact', async () => {
      const ctx = await bootPolicy({ secrets: { s: 'topsecret' } })
      const input = {
        messages: [{ role: 'user', content: 'here is topsecret data' }],
        nested: { list: ['a', 'topsecret', 3, null, true] },
        count: 5,
      }
      const out = ctx.egress.redactValue(input)
      expect(out).toEqual({
        messages: [{ role: 'user', content: 'here is [redacted:s] data' }],
        nested: { list: ['a', '[redacted:s]', 3, null, true] },
        count: 5,
      })
    })

    it('a seeded fake secret never survives redaction even split across a larger string', async () => {
      const ctx = await bootPolicy({ secrets: { k: 'AKIAFAKEEXAMPLE1234' } })
      const text = `export AWS_KEY=AKIAFAKEEXAMPLE1234\nsome other text AKIAFAKEEXAMPLE1234 end`
      const out = ctx.egress.redact(text)
      expect(out).not.toContain('AKIAFAKEEXAMPLE1234')
    })
  })
})
