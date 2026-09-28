import { join } from 'node:path'
import { Context } from 'cordis'
import { AppCore, BudgetExceededError } from '../bundles/app-core/index.js'
import { AutoCredentialStore, FileCredentialStore, KeychainCredentialStore, type CredentialStore } from '../bundles/app-core/credentials.js'
import { EgressPolicy, FileConsentStore, type ConsentStore } from '../bundles/egress/index.js'
import { LLMError, LLMService, OllamaProvider, OpenAICompatibleProvider, type LLMProvider } from '../bundles/model-adapter/index.js'
import { SessionLog } from '../bundles/session-log/index.js'

export interface RunArgs {
  prompt: string
  projectId: string
  kind: 'ollama' | 'openai-compatible'
  model: string
  baseUrl?: string
  /** Provider name; for openai-compatible also the credential key suffix (`provider:<name>`), matching what the wizard stores. */
  name?: string
  /** Daily hard request limit. Persisted across runs in `<stateDir>/budget.json`. Omit for no limit. */
  dailyLimit?: number
}

export interface RunDeps {
  fetch?: typeof fetch
  credentialStore?: CredentialStore
  consentStore?: ConsentStore
  /** Where session logs, consent and the day's budget persist. Default `.harness`. */
  stateDir?: string
  now?: () => number
}

export type RunResult =
  | { ok: true; text: string; model: string; requestsLeftToday?: number; sessionId: string }
  | { ok: false; reason: 'budget' | 'consent' | 'config' | 'provider'; message: string }

/**
 * `harness run` (1B.2 test enabler, D-043): one prompt, one call through the real `LLMService`,
 * with the day's request budget spent first. Deliberately not an agent loop - a single completion.
 *
 * Every attempt counts against the request budget, including one that then fails (a metered
 * provider bills attempts too, and it keeps the hard stop simple: spend, then call). A refused
 * call (budget, consent) never reaches the provider.
 */
export async function runTask(io: { print(line: string): void }, args: RunArgs, deps: RunDeps = {}): Promise<RunResult> {
  const stateDir = deps.stateDir ?? '.harness'
  const credentials =
    deps.credentialStore ??
    new AutoCredentialStore(new KeychainCredentialStore('harness'), new FileCredentialStore({ path: join(stateDir, 'credentials.json') }))

  let provider: LLMProvider
  let providerName: string
  if (args.kind === 'ollama') {
    providerName = 'ollama'
    provider = new OllamaProvider({ model: args.model, ...(args.baseUrl ? { baseUrl: args.baseUrl } : {}), fetch: deps.fetch })
  } else {
    providerName = args.name ?? 'openrouter'
    const apiKey = await credentials.get(`provider:${providerName}`)
    if (!apiKey) return { ok: false, reason: 'config', message: `no stored key for "${providerName}" - run the wizard first (npm run harness)` }
    provider = new OpenAICompatibleProvider({
      name: providerName,
      model: args.model,
      baseUrl: args.baseUrl ?? 'https://openrouter.ai/api/v1',
      apiKey,
      fetch: deps.fetch,
    })
  }

  // "With the network off, the harness starts and says what works" (1B.2): boot makes no network call.
  const remote = provider.egress?.remote === true
  io.print(remote ? `network: "${providerName}" is a cloud provider - it needs the network; nothing works offline.` : `network: "${providerName}" runs on this machine - works offline.`)

  const ctx = new Context()
  await ctx.plugin(SessionLog, { path: join(stateDir, 'sessions') })
  await ctx.plugin(EgressPolicy, {
    projectId: args.projectId,
    allowedHosts: remote ? [provider.egress!.host] : [],
    consentStore: deps.consentStore ?? new FileConsentStore(join(stateDir, 'consent.json')),
  })
  await ctx.plugin(LLMService, { egress: { consent: await ctx.egress.hasConsent() } })
  ctx.llm.register(providerName, provider, { default: true })
  await ctx.plugin(AppCore, {
    budgets: {
      ...(args.dailyLimit !== undefined ? { requests: { day: { hard: args.dailyLimit } } } : {}),
      statePath: join(stateDir, 'budget.json'),
      now: deps.now,
    },
    credentials: { store: credentials },
  })
  const budgets = ctx.appCore.budgets

  try {
    budgets.spend('requests', 1)
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      io.print(`stopped: ${e.metric}/${e.scope} hard limit reached - the provider was not called.`)
      return { ok: false, reason: 'budget', message: e.message }
    }
    throw e
  }

  const sessionId = ctx.log.create()
  try {
    const res = await ctx.llm.complete({ sessionId, actor: 'cli.run', messages: [{ role: 'user', content: args.prompt }] })
    try {
      budgets.spend('tokens', res.usage.inputTokens + res.usage.outputTokens)
    } catch {
      io.print('note: token budget exceeded by this call.')
    }
    const requestsLeftToday = budgets.requestsLeftToday()
    io.print(res.text)
    if (requestsLeftToday !== undefined) io.print(`requests left today: ${requestsLeftToday}`)
    return { ok: true, text: res.text, model: res.model, requestsLeftToday, sessionId }
  } catch (e) {
    if (e instanceof LLMError) {
      const reason = e.kind === 'consent' ? 'consent' : 'provider'
      io.print(`failed (${e.kind}): ${e.message}`)
      return { ok: false, reason, message: e.message }
    }
    throw e
  }
}
