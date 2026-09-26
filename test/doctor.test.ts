import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { Budgets } from '../src/bundles/app-core/budgets.js'
import {
  AutoCredentialStore,
  FileCredentialStore,
  KeychainCredentialStore,
  describeCredentialStore,
  type CredentialStore,
} from '../src/bundles/app-core/credentials.js'
import { buildDoctorReport, type EgressStatusSource } from '../src/bundles/app-core/doctor.js'
import { EgressPolicy, MemoryConsentStore } from '../src/bundles/egress/index.js'

// Small local fakes - mirrors credentials.test.ts's own fakes for AutoCredentialStore,
// but kept local since that file doesn't export them.
class MemoryStore implements CredentialStore {
  data = new Map<string, string>()
  async get(key: string) {
    return this.data.get(key)
  }
  async set(key: string, value: string) {
    this.data.set(key, value)
  }
  async delete(key: string) {
    this.data.delete(key)
  }
}
class AlwaysThrowsStore implements CredentialStore {
  async get(): Promise<string | undefined> {
    throw new Error('unavailable')
  }
  async set(): Promise<void> {
    throw new Error('unavailable')
  }
  async delete(): Promise<void> {
    throw new Error('unavailable')
  }
}

describe('describeCredentialStore', () => {
  it('a bare KeychainCredentialStore reports "keychain" without probing anything', async () => {
    expect(await describeCredentialStore(new KeychainCredentialStore('svc'))).toBe('keychain')
  })

  it('a bare FileCredentialStore reports "file"', async () => {
    expect(await describeCredentialStore(new FileCredentialStore({ path: '/tmp/does-not-matter.json' }))).toBe('file')
  })

  it('an AutoCredentialStore that resolved to its primary reports "keychain"', async () => {
    const auto = new AutoCredentialStore(new MemoryStore(), new MemoryStore())
    await auto.set('k', 'v') // triggers the probe
    expect(await describeCredentialStore(auto)).toBe('keychain')
  })

  it('an AutoCredentialStore that fell back reports "file", and only probes once', async () => {
    const primary = new AlwaysThrowsStore()
    const fallback = new MemoryStore()
    const auto = new AutoCredentialStore(primary, fallback)
    expect(await describeCredentialStore(auto)).toBe('file')
    expect(await auto.which()).toBe('fallback') // second call, same cached verdict
  })

  it('a caller-injected custom store (neither keychain, file, nor auto) reports "unresolved"', async () => {
    expect(await describeCredentialStore(new MemoryStore())).toBe('unresolved')
  })
})

describe('EgressPolicy.status()', () => {
  async function boot(config: { allowedHosts?: string[] } = {}) {
    const ctx = new Context()
    await ctx.plugin(EgressPolicy, { projectId: 'proj-1', consentStore: new MemoryConsentStore(), ...config })
    return ctx
  }

  it('no consent record yet: consented false, decidedAt absent, projectId and allowlist still reported', async () => {
    const ctx = await boot({ allowedHosts: ['api.example.com'] })
    const status = await ctx.egress.status()
    expect(status).toEqual({ projectId: 'proj-1', consented: false, decidedAt: undefined, allowedHosts: ['api.example.com'] })
  })

  it('reflects a granted consent, with its decision timestamp', async () => {
    const ctx = await boot()
    const granted = await ctx.egress.grantConsent()
    const status = await ctx.egress.status()
    expect(status.consented).toBe(true)
    expect(status.decidedAt).toBe(granted.decidedAt)
  })

  it('reflects a revoked consent (recorded "no", distinct from never having asked)', async () => {
    const ctx = await boot()
    await ctx.egress.grantConsent()
    await ctx.egress.revokeConsent()
    const status = await ctx.egress.status()
    expect(status.consented).toBe(false)
    expect(status.decidedAt).toBeDefined()
  })

  it('is read-only: calling it does not itself create or change a consent record', async () => {
    const ctx = await boot()
    await ctx.egress.status()
    await ctx.egress.status()
    expect(await ctx.egress.hasConsent()).toBe(false)
  })

  it('reports the allowlist exactly as configured, empty by default', async () => {
    const noHosts = await boot()
    expect((await noHosts.egress.status()).allowedHosts).toEqual([])
    const withHosts = await boot({ allowedHosts: ['a.example.com', 'b.example.com'] })
    expect((await withHosts.egress.status()).allowedHosts).toEqual(['a.example.com', 'b.example.com'])
  })
})

describe('buildDoctorReport', () => {
  function fakeEgress(status: Awaited<ReturnType<EgressStatusSource['status']>>): EgressStatusSource {
    return { status: async () => status }
  }

  it('combines budgets, credential-store detection and egress status into one report, mutating nothing', async () => {
    const budgets = new Budgets({ requests: { day: { hard: 10 } } })
    budgets.spend('requests', 3)
    const credentials = new AutoCredentialStore(new MemoryStore(), new MemoryStore())
    const egress = fakeEgress({ projectId: 'proj-1', consented: true, decidedAt: 't', allowedHosts: ['openrouter.ai'] })

    const report = await buildDoctorReport(budgets, credentials, egress)

    expect(report.requestsLeftToday).toBe(7)
    expect(report.budgets.requests.day).toMatchObject({ used: 3, hard: 10 })
    expect(report.credentials).toEqual({ active: 'keychain' })
    expect(report.egress).toEqual({ projectId: 'proj-1', consented: true, decidedAt: 't', allowedHosts: ['openrouter.ai'] })

    // Nothing above should have side-effected budgets/credentials: a second report matches exactly.
    const again = await buildDoctorReport(budgets, credentials, egress)
    expect(again).toEqual(report)
  })

  it('requestsLeftToday is undefined when no daily hard request limit is configured', async () => {
    const budgets = new Budgets()
    const credentials = new FileCredentialStore({ path: '/tmp/x.json' })
    const egress = fakeEgress({ projectId: 'p', consented: false, allowedHosts: [] })
    const report = await buildDoctorReport(budgets, credentials, egress)
    expect(report.requestsLeftToday).toBeUndefined()
  })

  it('an unconsented project is reported plainly, not hidden or defaulted to true', async () => {
    const budgets = new Budgets()
    const credentials = new KeychainCredentialStore('svc')
    const egress = fakeEgress({ projectId: 'p', consented: false, allowedHosts: ['x.example.com'] })
    const report = await buildDoctorReport(budgets, credentials, egress)
    expect(report.egress.consented).toBe(false)
    expect(report.egress.allowedHosts).toEqual(['x.example.com'])
  })
})
