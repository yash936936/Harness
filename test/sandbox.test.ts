import { Context } from 'cordis'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { Subprocess } from '../src/bundles/subprocess/index.js'
import { Sandbox, SandboxError } from '../src/bundles/sandbox/index.js'
import { CrabboxProvider } from '../src/bundles/sandbox-crabbox/index.js'
import { CubeSandboxProvider, shellQuote, type CubeClient } from '../src/bundles/sandbox-cubesandbox/index.js'

const FAKE = join(__dirname, 'fixtures', 'fake-crabbox.mjs')
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function state(extra: Record<string, unknown> = {}) {
  const d = mkdtempSync(join(tmpdir(), 'harness-sbx-'))
  dirs.push(d)
  const file = join(d, 'state.json')
  writeFileSync(file, JSON.stringify({ leases: [], calls: [], ...extra }))
  return { file, read: () => JSON.parse(readFileSync(file, 'utf8')) as { leases: string[]; calls: string[][] } }
}

async function boot(opts: { consent?: boolean; hosts?: string[] } = {}) {
  const ctx = new Context()
  await ctx.plugin(EgressPolicy, { projectId: 'p', allowedHosts: opts.hosts ?? [] })
  if (opts.consent) await ctx.egress.grantConsent()
  await ctx.plugin(Subprocess, { timeoutMs: 20_000 })
  await ctx.plugin(Sandbox)
  return ctx
}
const crab = (ctx: Context, file: string, cfg: Record<string, unknown> = {}) =>
  new CrabboxProvider(ctx.subprocess, { bin: process.execPath, binArgs: [FAKE, file], ...cfg })

describe('5.1 crabbox provider (fake CLI)', () => {
  it('leases, runs, returns output, and confirms the lease released', async () => {
    const s = state(); const ctx = await boot()
    ctx.sandbox.register(crab(ctx, s.file))
    const r = await ctx.sandbox.run({ command: ['echo', 'hi'] })
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trim()).toBe('echo hi')
    expect(r.released).toBe(true)
    expect(s.read().leases).toEqual([])
    expect(s.read().calls.map((c) => c[0])).toEqual(['warmup', 'run', 'stop', 'list'])
  })
  it('passes the container runtime on warmup, only for a local provider', async () => {
    const s = state(); const ctx = await boot()
    ctx.sandbox.register(crab(ctx, s.file, { runtime: 'docker' }))
    await ctx.sandbox.run({ command: ['true'] })
    const warm = s.read().calls.find((c) => c[0] === 'warmup')!
    expect(warm).toContain('--local-container-runtime'); expect(warm[warm.indexOf('--local-container-runtime') + 1]).toBe('docker')
  })
  it('a failing command is a normal result and the lease is still released', async () => {
    const s = state({ failRun: true }); const ctx = await boot()
    ctx.sandbox.register(crab(ctx, s.file))
    const r = await ctx.sandbox.run({ command: ['false'] })
    expect(r.exitCode).toBe(7)
    expect(r.released).toBe(true)
    expect(s.read().leases).toEqual([])
  })
  it('broker unreachable: clear error, and a release is still attempted so no lease hangs', async () => {
    const s = state({ failWarmup: true }); const ctx = await boot()
    ctx.sandbox.register(crab(ctx, s.file))
    await expect(ctx.sandbox.run({ command: ['echo'] })).rejects.toMatchObject({ kind: 'unreachable' })
    expect(s.read().calls.map((c) => c[0])).toContain('stop')
    expect(s.read().leases).toEqual([])
  })
  it('reports released:false (not true) when the lease is still listed after stop', async () => {
    const s = state({ stopNoop: true }); const ctx = await boot()
    ctx.sandbox.register(crab(ctx, s.file))
    const r = await ctx.sandbox.run({ command: ['echo'] })
    expect(r.released).toBe(false)
    expect(r.releaseNote).toMatch(/still listed/)
    expect(s.read().calls.filter((c) => c[0] === 'stop')).toHaveLength(2)
  })
  it('crabbox binary missing: unreachable error, no throw of a raw spawn error', async () => {
    const ctx = await boot()
    ctx.sandbox.register(new CrabboxProvider(ctx.subprocess, { bin: 'definitely-not-a-real-binary-xyz' }))
    await expect(ctx.sandbox.run({ command: ['echo'] })).rejects.toBeInstanceOf(SandboxError)
  })
  it('doctor enforces the version pin', async () => {
    const s = state(); const ctx = await boot()
    expect((await crab(ctx, s.file, { expectedVersion: '0.0.0-fake' }).doctor()).ok).toBe(true)
    const bad = await crab(ctx, s.file, { expectedVersion: '9.9.9' }).doctor()
    expect(bad.ok).toBe(false)
    expect(bad.detail).toMatch(/pin/)
  })
  it('local-container is a local destination; other providers are remote and need consent + an allowlisted host', async () => {
    const s = state(); const ctx = await boot()
    expect(crab(ctx, s.file).destination).toBe('local')
    const remote = crab(ctx, s.file, { provider: 'hetzner' })
    expect(remote.destination).toBe('remote')
    ctx.sandbox.register(remote)
    await expect(ctx.sandbox.run({ command: ['echo'] })).rejects.toMatchObject({ kind: 'consent' })
    expect(s.read().calls).toEqual([])
    await ctx.egress.grantConsent()
    await expect(ctx.sandbox.run({ command: ['echo'] })).rejects.toMatchObject({ name: 'EgressError' })
    expect(s.read().calls).toEqual([])
  })
})

function fakeClient(over: { failKill?: boolean; failCreate?: boolean; bootDelay?: number } = {}) {
  const events: string[] = []
  const client: CubeClient = {
    async create() {
      if (over.failCreate) throw new Error('connect ECONNREFUSED')
      if (over.bootDelay) await new Promise((r) => setTimeout(r, over.bootDelay))
      events.push('create')
      return {
        id: 'sbx-1',
        async run(cmd) { events.push('run:' + cmd); return { exitCode: 0, stdout: 'out', stderr: '' } },
        async kill() { events.push('kill'); if (over.failKill) throw new Error('nope') },
      }
    },
  }
  return { client, events }
}

describe('5.2 cubesandbox provider (fake E2B client)', () => {
  const cfg = (client: CubeClient, extra: Record<string, unknown> = {}) => ({ apiUrl: 'https://cube.example.internal:3000', template: 't', client, ...extra })
  it('creates, runs a quoted argv, kills, and measures boot', async () => {
    const { client, events } = fakeClient(); const ctx = await boot({ consent: true, hosts: ['cube.example.internal'] })
    ctx.sandbox.register(new CubeSandboxProvider(cfg(client)))
    const r = await ctx.sandbox.run({ command: ['echo', "it's"] })
    expect(r.stdout).toBe('out')
    expect(r.released).toBe(true)
    expect(typeof r.bootMs).toBe('number')
    expect(events).toEqual(['create', `run:'echo' 'it'\\''s'`, 'kill'])
  })
  it('flags a boot slower than the budget without failing the run', async () => {
    const { client } = fakeClient({ bootDelay: 60 }); const ctx = await boot({ consent: true, hosts: ['cube.example.internal'] })
    ctx.sandbox.register(new CubeSandboxProvider(cfg(client, { bootBudgetMs: 10 })))
    const r = await ctx.sandbox.run({ command: ['true'] })
    expect(r.exitCode).toBe(0)
    expect(r.releaseNote).toMatch(/slow boot/)
  })
  it('a failed kill is reported as released:false', async () => {
    const { client } = fakeClient({ failKill: true }); const ctx = await boot({ consent: true, hosts: ['cube.example.internal'] })
    ctx.sandbox.register(new CubeSandboxProvider(cfg(client)))
    const r = await ctx.sandbox.run({ command: ['true'] })
    expect(r.released).toBe(false)
    expect(r.releaseNote).toMatch(/kill failed/)
  })
  it('server unreachable: clear error', async () => {
    const { client } = fakeClient({ failCreate: true }); const ctx = await boot({ consent: true, hosts: ['cube.example.internal'] })
    ctx.sandbox.register(new CubeSandboxProvider(cfg(client)))
    await expect(ctx.sandbox.run({ command: ['true'] })).rejects.toMatchObject({ kind: 'unreachable' })
  })
  it('is always remote: blocked without consent, blocked off the allowlist, nothing created', async () => {
    const { client, events } = fakeClient()
    const noConsent = await boot({ hosts: ['cube.example.internal'] })
    noConsent.sandbox.register(new CubeSandboxProvider(cfg(client)))
    await expect(noConsent.sandbox.run({ command: ['true'] })).rejects.toMatchObject({ kind: 'consent' })
    const offList = await boot({ consent: true, hosts: ['other.host'] })
    offList.sandbox.register(new CubeSandboxProvider(cfg(client)))
    await expect(offList.sandbox.run({ command: ['true'] })).rejects.toMatchObject({ name: 'EgressError' })
    expect(events).toEqual([])
  })
  it('rejects a bad apiUrl and shellQuote handles quotes', () => {
    expect(() => new CubeSandboxProvider({ apiUrl: 'nope', template: 't' })).toThrow(SandboxError)
    expect(shellQuote(['a b', "c'd"])).toBe(`'a b' 'c'\\''d'`)
  })
})

describe('ctx.sandbox seam', () => {
  it('unknown provider, empty command, duplicate registration, status', async () => {
    const s = state(); const ctx = await boot()
    await expect(ctx.sandbox.run({ command: ['x'] })).rejects.toMatchObject({ kind: 'unknown-provider' })
    ctx.sandbox.register(crab(ctx, s.file))
    await expect(ctx.sandbox.run({ command: [] })).rejects.toMatchObject({ kind: 'config' })
    expect(() => ctx.sandbox.register(crab(ctx, s.file))).toThrow(SandboxError)
    expect(ctx.sandbox.status()).toEqual([{ name: 'crabbox', destination: 'local', host: undefined, default: true }])
  })
  it('two providers: a request is routed by name', async () => {
    const s = state(); const { client, events } = fakeClient()
    const ctx = await boot({ consent: true, hosts: ['cube.example.internal'] })
    ctx.sandbox.register(crab(ctx, s.file), { default: true })
    ctx.sandbox.register(new CubeSandboxProvider({ apiUrl: 'https://cube.example.internal', template: 't', client }))
    expect((await ctx.sandbox.run({ command: ['echo'] })).provider).toBe('crabbox')
    expect((await ctx.sandbox.run({ command: ['echo'], provider: 'cubesandbox' })).provider).toBe('cubesandbox')
    expect(events).toContain('create')
  })
})

import { mkdirSync, realpathSync } from 'node:fs'
import { Budgets } from '../src/bundles/app-core/budgets.js'
import { AutoCredentialStore, type CredentialStore } from '../src/bundles/app-core/credentials.js'
import { buildDoctorReport } from '../src/bundles/app-core/doctor.js'
import { bootProfileCoding } from '../src/profiles/profile-coding.js'

class MemoryStore implements CredentialStore {
  data = new Map<string, string>()
  async get(key: string) { return this.data.get(key) }
  async set(key: string, value: string) { this.data.set(key, value) }
  async delete(key: string) { this.data.delete(key) }
}

describe('wiring: profile-coding and doctor (5.1/5.2)', () => {
  it('profile-coding registers the configured providers; none configured = empty, nothing remote by default', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'harness-sbx-pc-'))); dirs.push(root); mkdirSync(join(root, 'src'))
    const bare = await bootProfileCoding({ projectId: 'p', projectRoot: root, sessionLog: { memory: true } })
    expect(bare.sandbox.status()).toEqual([])
    const s = state()
    const full = await bootProfileCoding({
      projectId: 'p', projectRoot: root, sessionLog: { memory: true },
      sandbox: { crabbox: { bin: process.execPath, binArgs: [FAKE, s.file] }, cubesandbox: { apiUrl: 'https://cube.example.internal', template: 't', client: fakeClient().client }, default: 'crabbox' },
    })
    expect(full.sandbox.status().map((x) => `${x.name}:${x.destination}:${x.default}`)).toEqual(['crabbox:local:true', 'cubesandbox:remote:false'])
    // a remote provider is not usable until the project consents and allowlists its host
    await expect(full.sandbox.run({ command: ['true'], provider: 'cubesandbox' })).rejects.toMatchObject({ kind: 'consent' })
  })
  it('doctor lists sandboxes only when given, remote ones flagged as destinations', async () => {
    const budgets = new Budgets({}); const credentials = new AutoCredentialStore(new MemoryStore(), new MemoryStore())
    const egress = { status: async () => ({ projectId: 'p', consented: false, allowedHosts: [] }) }
    expect((await buildDoctorReport(budgets, credentials, egress)).sandboxes).toBeUndefined()
    const rows = [{ name: 'cubesandbox', destination: 'remote' as const, host: 'cube.example.internal', default: false }]
    expect((await buildDoctorReport(budgets, credentials, egress, undefined, undefined, rows)).sandboxes).toEqual(rows)
  })
})
