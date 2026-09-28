import { describe, expect, it } from 'vitest'
import type { AskOptions, ConfirmOptions, WizardIO } from '../src/cli/io.js'
import { formatDoctorReport, runWizard, type WizardCompleted, type WizardDeps } from '../src/cli/wizard.js'
import type { CredentialStore } from '../src/bundles/app-core/credentials.js'
import { MemoryConsentStore } from '../src/bundles/egress/index.js'
import type { BudgetStatus, ScopeStatus } from '../src/bundles/app-core/budgets.js'
import type { DoctorReport } from '../src/bundles/app-core/doctor.js'

/** Every scenario that reaches `ctx.plugin(EgressPolicy, ...)` needs this - otherwise `runWizard`'s
 * real default (`FileConsentStore('.harness/consent.json')`) writes to the actual filesystem. */
function deps(over: Omit<WizardDeps, 'consentStore'>): WizardDeps {
  return { ...over, consentStore: new MemoryConsentStore() }
}

// ── Fakes ────────────────────────────────────────────────────────────────

/** Feeds a fixed queue of answers/confirms in call order - mirrors the wizard's own real prompt order exactly. */
class ScriptedIO implements WizardIO {
  lines: string[] = []
  constructor(
    private answers: string[] = [],
    private confirms: boolean[] = [],
  ) {}
  print(line: string) {
    this.lines.push(line)
  }
  async ask(prompt: string, _opts?: AskOptions) {
    if (this.answers.length === 0) throw new Error(`ScriptedIO: no more scripted answers, but was asked "${prompt}"`)
    return this.answers.shift()!
  }
  async confirm(prompt: string, _opts?: ConfirmOptions) {
    if (this.confirms.length === 0) throw new Error(`ScriptedIO: no more scripted confirms, but was asked "${prompt}"`)
    return this.confirms.shift()!
  }
}

class MemoryCredentialStore implements CredentialStore {
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

/** Accepts writes but never returns them - the exact "silently broken backend" shape credentials.ts already documents. */
class SilentlyBrokenCredentialStore implements CredentialStore {
  async get() {
    return undefined
  }
  async set() {}
  async delete() {}
}

type FetchCall = { url: string; init: RequestInit }
function fakeFetch(respond: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = []
  const f = (async (url: any, init: any) => {
    const call = { url: String(url), init }
    calls.push(call)
    return respond(call)
  }) as typeof fetch
  return { f, calls }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const chatOk = (model: string) => ({ model, choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] })

// ── Scenarios ────────────────────────────────────────────────────────────

describe('runWizard', () => {
  it('mock provider: no remote-consent prompt, no allowlist entry, doctor reflects the whole run', async () => {
    const io = new ScriptedIO(['proj-mock', 'mock', 'my-mock-model'], [false /* decline daily budget */])
    const credentialStore = new MemoryCredentialStore()

    const result = await runWizard(io, deps({ credentialStore }))
    expect(result.aborted).toBe(false)
    const r = result as WizardCompleted
    expect(r.providerKind).toBe('mock')
    expect(r.connectionOk).toBe(true)
    expect(r.consentRequired).toBe(false)
    expect(r.consented).toBe(true) // vacuous - nothing to consent to
    expect(r.report.egress.consented).toBe(false) // no record was ever written for a local binding
    expect(r.report.egress.allowedHosts).toEqual([])
    expect(r.report.credentials.active).toBe('unresolved') // a bare fake, not Auto/Keychain/File
    expect(r.report.requestsLeftToday).toBeUndefined() // budget was declined
    expect(r.report.models).toEqual([{ bindingName: 'worker', resolvedId: 'qwen2.5-coder:3b-instruct', usedPin: true, unavailable: false }])

    expect(io.lines.some((l) => l.includes('Local provider'))).toBe(true)
    expect(io.lines.some((l) => l.startsWith('--- doctor ---'))).toBe(true)
  })

  it('openai-compatible: successful connection, consent granted, allowlist and budget both wired through to doctor', async () => {
    const { f } = fakeFetch((call) => (call.url.endsWith('/models') ? json(200, { data: [{ id: 'a' }] }) : json(200, chatOk('gpt-test'))))
    const io = new ScriptedIO(
      ['proj-2', 'openai-compatible', 'openrouter', 'https://openrouter.ai/api/v1', 'gpt-test', 'sk-test-key-123', '200'],
      [true /* ok to contact host */, true /* set a daily budget */, true /* consent */],
    )
    const credentialStore = new MemoryCredentialStore()

    const result = await runWizard(io, deps({ fetch: f, credentialStore }))
    expect(result.aborted).toBe(false)
    const r = result as WizardCompleted
    expect(r.connectionOk).toBe(true)
    expect(r.consentRequired).toBe(true)
    expect(r.consented).toBe(true)
    expect(await r.ctx.egress.hasConsent()).toBe(true)
    expect(r.report.egress.consented).toBe(true)
    expect(r.report.egress.allowedHosts).toEqual(['openrouter.ai'])
    expect(r.report.requestsLeftToday).toBe(200) // default daily hard limit accepted, nothing spent yet
    expect(await credentialStore.get('provider:openrouter')).toBe('sk-test-key-123')
  })

  it('declines the remote-acknowledge gate, then declines to continue anyway: aborts without touching consent/budgets, but the key is still stored', async () => {
    const { f, calls } = fakeFetch(() => json(200, chatOk('m')))
    const io = new ScriptedIO(
      ['proj-3', 'openai-compatible', 'openrouter', 'https://openrouter.ai/api/v1', 'm', 'sk-abort-key'],
      [false /* don't contact host */, false /* don't continue anyway */],
    )
    const credentialStore = new MemoryCredentialStore()

    const result = await runWizard(io, deps({ fetch: f, credentialStore }))
    expect(result).toEqual({ aborted: true, reason: 'connection_test_failed' })
    expect(calls.length).toBe(0) // acknowledgeRemote:false means no network call was ever attempted
    expect(await credentialStore.get('provider:openrouter')).toBe('sk-abort-key')
  })

  it('a real connection failure (bad key): can still continue anyway and decline consent, which revokes rather than leaving no record', async () => {
    const { f } = fakeFetch(() => json(401, { error: { message: 'bad key' } }))
    const io = new ScriptedIO(
      ['proj-4', 'openai-compatible', 'openrouter', 'https://openrouter.ai/api/v1', 'm', 'sk-bad-key'],
      [true /* contact host */, true /* continue anyway despite failure */, false /* decline budget */, false /* decline consent */],
    )
    const credentialStore = new MemoryCredentialStore()

    const result = await runWizard(io, deps({ fetch: f, credentialStore }))
    expect(result.aborted).toBe(false)
    const r = result as WizardCompleted
    expect(r.connectionOk).toBe(false)
    expect(r.consented).toBe(false)
    expect(await r.ctx.egress.hasConsent()).toBe(false)
    expect(r.report.egress.consented).toBe(false)
    expect(r.report.egress.decidedAt).toBeDefined() // revoked, not "never asked" - a real decision was recorded
  })

  it('refuses to proceed when the credential store cannot prove the key round-tripped', async () => {
    const { f, calls } = fakeFetch(() => json(200, chatOk('m')))
    const io = new ScriptedIO(['proj-5', 'openai-compatible', 'openrouter', 'https://openrouter.ai/api/v1', 'm', 'sk-key'], [])
    const credentialStore = new SilentlyBrokenCredentialStore()

    await expect(runWizard(io, deps({ fetch: f, credentialStore }))).rejects.toThrow(/did not round-trip/)
    expect(calls.length).toBe(0) // never got as far as testing the connection
  })

  it('ollama on localhost is treated as local - no acknowledge-remote prompt, no consent prompt', async () => {
    const { f } = fakeFetch((call) =>
      call.url.endsWith('/api/tags') ? json(200, { models: [] }) : json(200, { model: 'llama3.2:3b', message: { role: 'assistant', content: 'ok' }, done_reason: 'stop' }),
    )
    const io = new ScriptedIO(['proj-6', 'ollama', 'http://localhost:11434', 'llama3.2:3b'], [false /* decline budget */])
    const credentialStore = new MemoryCredentialStore()

    const result = await runWizard(io, deps({ fetch: f, credentialStore }))
    expect(result.aborted).toBe(false)
    const r = result as WizardCompleted
    expect(r.consentRequired).toBe(false)
    expect(r.report.egress.allowedHosts).toEqual([])
  })

  it('reprompts on an unrecognized provider kind rather than accepting it', async () => {
    const io = new ScriptedIO(['proj-7', 'not-a-real-provider', 'mock', 'm'], [false])
    const result = await runWizard(io, deps({ credentialStore: new MemoryCredentialStore() }))
    expect(result.aborted).toBe(false)
    expect(io.lines.some((l) => l.includes('Not one of'))).toBe(true)
  })
})

// ── formatDoctorReport (pure) ───────────────────────────────────────────

function emptyScope(): ScopeStatus {
  return { used: 0, softBreached: false, hardBreached: false }
}
function emptyBudgetStatus(): BudgetStatus {
  return {
    requests: { task: emptyScope(), session: emptyScope(), day: emptyScope() },
    tokens: { task: emptyScope(), session: emptyScope(), day: emptyScope() },
  }
}
function baseReport(over: Partial<DoctorReport> = {}): DoctorReport {
  return {
    budgets: emptyBudgetStatus(),
    credentials: { active: 'keychain' },
    egress: { projectId: 'p', consented: false, allowedHosts: [] },
    ...over,
  }
}

describe('formatDoctorReport', () => {
  it('an unconfigured budget produces no budget lines at all - not noise for every scope/metric combination', () => {
    const lines = formatDoctorReport(baseReport())
    expect(lines.some((l) => l.startsWith('budget '))).toBe(false)
    expect(lines.some((l) => l.startsWith('requests left today'))).toBe(false)
  })

  it('shows "(never asked)" with no record, and the real decision timestamp once one exists', () => {
    const never = formatDoctorReport(baseReport())
    expect(never.find((l) => l.startsWith('egress:'))).toContain('(never asked)')
    const decided = formatDoctorReport(baseReport({ egress: { projectId: 'p', consented: true, decidedAt: '2026-01-01T00:00:00.000Z', allowedHosts: [] } }))
    expect(decided.find((l) => l.startsWith('egress:'))).toContain('(decided 2026-01-01T00:00:00.000Z)')
  })

  it('shows "(none)" for an empty allowlist and a comma-joined list otherwise', () => {
    const none = formatDoctorReport(baseReport())
    expect(none.find((l) => l.startsWith('egress allowlist:'))).toContain('(none)')
    const some = formatDoctorReport(baseReport({ egress: { projectId: 'p', consented: false, allowedHosts: ['a.com', 'b.com'] } }))
    expect(some.find((l) => l.startsWith('egress allowlist:'))).toContain('a.com, b.com')
  })

  it('a configured, breached scope shows used/hard and both breach flags', () => {
    const budgets = emptyBudgetStatus()
    budgets.requests.day = { used: 12, soft: 10, hard: 10, softBreached: true, hardBreached: true }
    const lines = formatDoctorReport(baseReport({ budgets }))
    const line = lines.find((l) => l.startsWith('budget requests/day'))!
    expect(line).toContain('12/10')
    expect(line).toContain('soft limit reached')
    expect(line).toContain('HARD LIMIT REACHED')
  })

  it('requestsLeftToday is shown only when present', () => {
    expect(formatDoctorReport(baseReport({ requestsLeftToday: 42 })).find((l) => l.startsWith('requests left today'))).toBe('requests left today: 42')
    expect(formatDoctorReport(baseReport()).find((l) => l.startsWith('requests left today'))).toBeUndefined()
  })

  it('no model lines at all when `models` (1B.3) is absent - not an empty section', () => {
    expect(formatDoctorReport(baseReport()).some((l) => l.startsWith('model binding'))).toBe(false)
  })

  it('distinguishes a pinned, a fallback, and an unavailable model binding', () => {
    const lines = formatDoctorReport(
      baseReport({
        models: [
          { bindingName: 'worker', resolvedId: 'pinned-model', usedPin: true, unavailable: false },
          { bindingName: 'router', resolvedId: 'fallback-model', usedPin: false, unavailable: false },
          { bindingName: 'ghost', usedPin: false, unavailable: true },
        ],
      }),
    )
    expect(lines.find((l) => l.includes('"worker"'))).toBe('model binding "worker": pinned-model (pin registered)')
    expect(lines.find((l) => l.includes('"router"'))).toBe('model binding "router": fallback-model (fallback registered - pin not registered)')
    expect(lines.find((l) => l.includes('"ghost"'))).toContain('UNAVAILABLE')
  })
})

describe('formatDoctorReport: installed-vs-pinned lines (D-043)', () => {
  it('renders each status distinctly', () => {
    const lines = formatDoctorReport(baseReport({ installed: [
      { id: 'a', status: 'matches_pin' }, { id: 'b', status: 'differs_from_pin', installedDigest: 'x' },
      { id: 'c', status: 'not_installed' }, { id: 'd', status: 'unchecked' } ] }))
    expect(lines.find((l) => l.includes('"a"'))).toContain('digest matches the pin')
    expect(lines.find((l) => l.includes('"b"'))).toContain('DIFFERS')
    expect(lines.find((l) => l.includes('"c"'))).toContain('NOT installed')
    expect(lines.find((l) => l.includes('"d"'))).toContain('no digest to compare')
  })
})
