import { basename } from 'node:path'
import { cwd } from 'node:process'
import { Context } from 'cordis'
import { AppCore, type DoctorReport } from '../bundles/app-core/index.js'
import { AutoCredentialStore, FileCredentialStore, KeychainCredentialStore, type CredentialStore } from '../bundles/app-core/credentials.js'
import { testProviderConnection } from '../bundles/app-core/provider-connection.js'
import type { BudgetsConfig } from '../bundles/app-core/budgets.js'
import { EgressPolicy, FileConsentStore, type ConsentStore } from '../bundles/egress/index.js'
import { MockProvider, OllamaProvider, OpenAICompatibleProvider, type LLMProvider } from '../bundles/model-adapter/index.js'
import { ModelStore, NEEDLE_PIN, REFERENCE_WORKER_BINDING, ROUTER_BINDING, REFERENCE_WORKER_PIN } from '../bundles/model-store/index.js'
import type { WizardIO } from './io.js'

export type ProviderKind = 'mock' | 'ollama' | 'openai-compatible'
const PROVIDER_KINDS: ProviderKind[] = ['mock', 'ollama', 'openai-compatible']

export interface WizardDeps {
  /** Threaded into any HTTP-based provider construction. Default: global `fetch`. Tests inject a mock. */
  fetch?: typeof fetch
  /**
   * Where credentials persist. Default: the same keychain-then-file chain
   * `AppCore`'s own default uses. Tests inject a plain in-memory fake so a
   * test run never touches the real OS keychain or writes a real file.
   */
  credentialStore?: CredentialStore
  /** Where consent persists. Default: `.harness/consent.json`. Tests inject `MemoryConsentStore`. */
  consentStore?: ConsentStore
}

export interface WizardCompleted {
  aborted: false
  ctx: Context
  providerKind: ProviderKind
  providerName: string
  connectionOk: boolean
  /** Whether this binding needed a consent decision at all (false for every local provider). */
  consentRequired: boolean
  /** For a local binding (`consentRequired: false`) this is vacuously `true` - there was nothing to consent to. */
  consented: boolean
  report: DoctorReport
}

export interface WizardAborted {
  aborted: true
  reason: 'connection_test_failed'
}

export type WizardResult = WizardCompleted | WizardAborted

/**
 * The terminal wizard's orchestration (1B.2, D-040): provider setup,
 * credential storage, the connection test, the consent screen, an optional
 * budget, and a final `doctor` report - the four+one pieces of 1B.2 used
 * together for the first time. Takes a `WizardIO` rather than talking to
 * `process.stdin`/`stdout` directly so the whole flow is scriptable in
 * tests (`test/wizard.test.ts`) without a real terminal.
 *
 * Deliberately setup-only: this does not register the provider on
 * `ctx.llm`, boot `LLMService`, or set `ModelAdapterConfig.egress.consent`
 * (D-022's separate binding-level flag) - there is no "run a task" command
 * yet for that provider to serve, and inventing one here would blur what
 * this slice is actually responsible for. It ends at a real, doctor-
 * verified project configuration, not a running session.
 */
export async function runWizard(io: WizardIO, deps: WizardDeps = {}): Promise<WizardResult> {
  io.print('Coding Harness - project setup')
  io.print('')

  const projectId = await io.ask('Project ID (tracks consent for this project)', { default: basename(cwd()) })

  const kind = await askProviderKind(io)
  const { provider, providerName, apiKeyEntered } = await collectProvider(io, kind, deps.fetch)

  const credentials =
    deps.credentialStore ??
    new AutoCredentialStore(new KeychainCredentialStore('harness'), new FileCredentialStore({ path: '.harness/credentials.json' }))

  if (apiKeyEntered !== undefined) {
    const credentialKey = `provider:${providerName}`
    await credentials.set(credentialKey, apiKeyEntered)
    const roundTripped = await credentials.get(credentialKey)
    if (roundTripped !== apiKeyEntered) {
      // Never proceed to testing a key we can't prove was actually stored - see credentials.ts's own
      // note on AutoCredentialStore: a broken backend can accept a write and just never return it.
      throw new Error(`credential storage did not round-trip for "${credentialKey}" - refusing to continue with an unverified key`)
    }
    io.print(`Key stored under "${credentialKey}".`)
  }

  let acknowledgeRemote = true
  if (provider.egress?.remote) {
    acknowledgeRemote = await io.confirm(`About to contact ${provider.egress.host} to test the connection. Continue?`, { default: true })
  }

  io.print('Testing connection...')
  const result = await testProviderConnection(provider, { acknowledgeRemote })
  if (result.ok) {
    io.print(`Connected - "${providerName}" responded as "${result.model}" in ${result.latencyMs}ms.`)
    if (result.models?.ok) io.print(`${result.models.names?.length ?? 0} model(s) visible on the host.`)
    else if (result.models && !result.models.ok) io.print(`(could not list models: ${result.models.error})`)
  } else {
    io.print(`Connection test failed (${result.error!.kind}): ${result.error!.message}`)
    const proceedAnyway = await io.confirm('Continue setup anyway? You can fix this and re-run the wizard later.', { default: false })
    if (!proceedAnyway) {
      io.print('Setup not completed. Nothing was configured beyond the credential above, if one was entered.')
      return { aborted: true, reason: 'connection_test_failed' }
    }
  }

  const budgets = await collectBudgets(io)

  const ctx = new Context()
  await ctx.plugin(EgressPolicy, {
    projectId,
    allowedHosts: provider.egress?.remote ? [provider.egress.host] : [],
    consentStore: deps.consentStore ?? new FileConsentStore('.harness/consent.json'),
  })
  await ctx.plugin(AppCore, { budgets, credentials: { store: credentials } })
  // The one real pin on record (D-042). Registered = trusted/pinned, NOT proof it is installed - see formatDoctorReport.
  await ctx.plugin(ModelStore, { models: [REFERENCE_WORKER_PIN, NEEDLE_PIN], bindings: [REFERENCE_WORKER_BINDING, ROUTER_BINDING] })

  const screen = ctx.appCore.consentScreen(providerName, provider.egress)
  io.print('')
  io.print(screen.generalStatement)
  io.print(screen.binding.destination)
  if (screen.binding.policyClaim) {
    io.print(`${screen.binding.policyClaim.provider} (checked ${screen.binding.policyClaim.checkedOn}): ${screen.binding.policyClaim.summary}`)
    if (screen.binding.policyClaim.sourceUrl) io.print(`Source: ${screen.binding.policyClaim.sourceUrl}`)
  }

  const consentRequired = !screen.binding.local
  let consented = true
  if (consentRequired) {
    consented = await io.confirm(`Grant consent for project "${projectId}" to send data to ${provider.egress!.host}?`, { default: false })
    if (consented) await ctx.egress.grantConsent()
    else await ctx.egress.revokeConsent()
  } else {
    io.print('Local provider - nothing leaves this machine, no consent needed.')
  }

  // Best-effort: only an Ollama provider can say what is installed. Failure just means no `installed` lines.
  const installed = provider instanceof OllamaProvider ? await provider.listInstalledModels().catch(() => undefined) : undefined
  const report = await ctx.appCore.doctor(ctx.egress, ctx.modelStore, installed)
  io.print('')
  for (const line of formatDoctorReport(report)) io.print(line)

  return { aborted: false, ctx, providerKind: kind, providerName, connectionOk: result.ok, consentRequired, consented, report }
}

async function askProviderKind(io: WizardIO): Promise<ProviderKind> {
  for (;;) {
    const raw = (await io.ask(`Provider (${PROVIDER_KINDS.join('/')})`, { default: 'ollama' })).trim().toLowerCase()
    if ((PROVIDER_KINDS as string[]).includes(raw)) return raw as ProviderKind
    io.print(`Not one of: ${PROVIDER_KINDS.join(', ')}.`)
  }
}

async function collectProvider(
  io: WizardIO,
  kind: ProviderKind,
  fetchOverride: typeof fetch | undefined,
): Promise<{ provider: LLMProvider; providerName: string; apiKeyEntered?: string }> {
  if (kind === 'mock') {
    const model = await io.ask('Model name to simulate', { default: 'mock-model' })
    return { provider: new MockProvider([{ text: 'ok', model }]), providerName: 'mock' }
  }
  if (kind === 'ollama') {
    const baseUrl = await io.ask('Ollama base URL', { default: 'http://localhost:11434' })
    const model = await io.ask('Model tag (must already be pulled, e.g. llama3.2:3b)')
    return { provider: new OllamaProvider({ baseUrl, model, fetch: fetchOverride }), providerName: 'ollama' }
  }
  // openai-compatible
  const providerName = await io.ask('Provider name (used for display and the consent screen, e.g. "openrouter")', { default: 'openrouter' })
  const baseUrl = await io.ask('Base URL', { default: 'https://openrouter.ai/api/v1' })
  const model = await io.ask('Model ID')
  const apiKey = await io.ask('API key (stored, never displayed again)', { secret: true })
  return {
    provider: new OpenAICompatibleProvider({ name: providerName, baseUrl, model, apiKey, fetch: fetchOverride }),
    providerName,
    apiKeyEntered: apiKey,
  }
}

async function collectBudgets(io: WizardIO): Promise<BudgetsConfig> {
  const wantsLimit = await io.confirm('Set a daily request budget for this project?', { default: true })
  if (!wantsLimit) return {}
  const raw = await io.ask('Daily hard request limit', { default: '200' })
  const hard = Number(raw)
  if (!Number.isFinite(hard) || hard <= 0) {
    io.print(`"${raw}" isn't a positive number - skipping the budget limit.`)
    return {}
  }
  const soft = Math.max(1, Math.floor(hard * 0.8))
  return { requests: { day: { hard, soft } } }
}

/** Pure formatting for `doctor`'s report - kept separate from `runWizard` so its output shape is testable on its own. */
export function formatDoctorReport(report: DoctorReport): string[] {
  const lines: string[] = ['--- doctor ---', `credentials: ${report.credentials.active}`]

  const decided = report.egress.decidedAt ? ` (decided ${report.egress.decidedAt})` : ' (never asked)'
  lines.push(`egress: project="${report.egress.projectId}" consented=${report.egress.consented}${decided}`)
  lines.push(`egress allowlist: ${report.egress.allowedHosts.length ? report.egress.allowedHosts.join(', ') : '(none)'}`)

  for (const metric of ['requests', 'tokens'] as const) {
    for (const scope of ['task', 'session', 'day'] as const) {
      const s = report.budgets[metric][scope]
      if (s.hard === undefined && s.soft === undefined) continue // unconfigured - not worth a line
      const limit = s.hard !== undefined ? `/${s.hard}` : ''
      const flags = [s.softBreached ? 'soft limit reached' : '', s.hardBreached ? 'HARD LIMIT REACHED' : ''].filter(Boolean)
      lines.push(`budget ${metric}/${scope}: ${s.used}${limit}${flags.length ? ` (${flags.join(', ')})` : ''}`)
    }
  }
  if (report.requestsLeftToday !== undefined) lines.push(`requests left today: ${report.requestsLeftToday}`)

  // Present only when a ModelStore (1B.3) was passed to doctor() - the wizard itself doesn't wire one in yet.
  if (report.models) {
    for (const m of report.models) {
      if (m.unavailable) lines.push(`model binding "${m.bindingName}": UNAVAILABLE - neither the pin nor any fallback is registered`)
      else if (m.usedPin) lines.push(`model binding "${m.bindingName}": ${m.resolvedId} (pin registered)`)
      else lines.push(`model binding "${m.bindingName}": ${m.resolvedId} (fallback registered - pin not registered)`)
    }
  }

  for (const c of report.installed ?? []) {
    if (c.status === 'matches_pin') lines.push(`model "${c.id}": installed, digest matches the pin`)
    else if (c.status === 'differs_from_pin') lines.push(`model "${c.id}": installed but its digest DIFFERS from the pin (tag moved or file changed) - reported ${c.installedDigest}`)
    else if (c.status === 'not_installed') lines.push(`model "${c.id}": NOT installed on this host`)
    else lines.push(`model "${c.id}": installed, but no digest to compare`)
  }

  return lines
}
