import { Context, Service } from 'cordis'
import '../session-log/index.js'
import '../egress/index.js'
import { EgressError } from '../egress/index.js'
import { OllamaProvider, type OllamaConfig } from './providers/ollama.js'
import { OpenAICompatibleProvider, type OpenAICompatibleConfig } from './providers/openai-compatible.js'
import { Budgets, BudgetExceededError, type BudgetsConfig } from '../app-core/budgets.js'
import { BudgetGate, type CallReservation } from './budget-gate.js'
import { RateLimiter, type RateLimiterConfig } from './rate-limiter.js'
import { LLMError, type CompletionRequest, type CompletionResponse, type EgressInfo, type LLMProvider } from './types.js'

export * from './types.js'
export { OllamaProvider, recoverTextToolCalls, resolveBaseUrl, type OllamaConfig } from './providers/ollama.js'
export { OpenAICompatibleProvider, type OpenAICompatibleConfig } from './providers/openai-compatible.js'
export { MockProvider } from './providers/mock.js'
export { RateLimiter, type RateLimiterConfig } from './rate-limiter.js'
export { BudgetGate, CallReservation, estimateRequestTokens, DEFAULT_OUTPUT_TOKEN_RESERVE } from './budget-gate.js'

export interface ModelAdapterConfig {
  /**
   * Request and token budgets enforced for EVERY model call through `ctx.llm` (ARCH-03): capacity is reserved before the
   * call (a call that cannot fit is refused, logged as `budget.blocked`, and never sent) and trued up with the provider's
   * reported usage afterwards. Omit for no limits.
   */
  budgets?: BudgetsConfig
  /** Output tokens reserved for a call that sets no `maxTokens`. Default 1024. */
  reserveOutputTokens?: number
  /**
   * One request limiter shared by every provider and every sub-agent (ARCH-03). Do not ALSO give a provider its own
   * `limiter`, or each call waits on both.
   */
  rateLimit?: RateLimiterConfig
  /** Name of the provider used when a request doesn't name one. */
  default?: string
  /** Built-in Ollama provider; registered as `ollama` when present. */
  ollama?: OllamaConfig
  /** Built-in OpenAI-compatible provider (OpenRouter and similar); registered under `name`. */
  openaiCompatible?: OpenAICompatibleConfig
  /**
   * Consent to send prompts to non-loopback hosts (D-022). Without `consent: true`
   * every remote provider call is refused before anything leaves the machine.
   * This is a per-binding flag, checked *in addition to* `ctx.egress`'s
   * per-project consent record (1B.1, D-029) — both must be true for a
   * remote call to go out. Kept separate from `ctx.egress` on purpose: this
   * flag says "this binding is configured to attempt remote calls at all";
   * `ctx.egress` says "this project has actually consented". Neither alone
   * is sufficient.
   */
  egress?: { consent?: boolean }
}

declare module 'cordis' {
  interface Context {
    llm: LLMService
  }
}

/**
 * `ctx.llm` — provider-agnostic model access. Depends on `ctx.log`.
 *
 * Every call is logged to the caller's session *before* the request leaves
 * the process (`model.request`) and after it resolves (`model.response` or
 * `model.error`). If the log write fails, the model is never called.
 */
export class LLMService extends Service {
  static inject = ['log', 'egress']
  private providers = new Map<string, LLMProvider>()
  private providerEgress = new Map<string, EgressInfo>()
  private defaultName?: string
  private readonly egressConsent: boolean
  private gate?: BudgetGate
  private readonly limiter?: RateLimiter

  constructor(ctx: Context, config: ModelAdapterConfig = {}) {
    super(ctx, 'llm')
    this.defaultName = config.default
    this.egressConsent = config.egress?.consent === true
    if (config.budgets) this.gate = new BudgetGate(new Budgets(config.budgets), config.reserveOutputTokens)
    if (config.rateLimit) this.limiter = new RateLimiter(config.rateLimit)
    if (config.ollama) {
      const provider = new OllamaProvider(config.ollama)
      this.providers.set('ollama', provider)
      this.providerEgress.set('ollama', Object.freeze({ ...provider.egress }))
      this.defaultName ??= 'ollama'
    }
    if (config.openaiCompatible) {
      const name = config.openaiCompatible.name ?? 'openai-compatible'
      const provider = new OpenAICompatibleProvider({ ...config.openaiCompatible, name })
      this.providers.set(name, provider)
      this.providerEgress.set(name, Object.freeze({ ...provider.egress }))
      this.defaultName ??= name
    }
  }

  /** Register a provider. Returns a disposer; use inside `ctx.effect` so it unregisters with its plugin. */
  register(name: string, provider: LLMProvider, opts: { default?: boolean } = {}): () => void {
    if (this.providers.has(name)) throw new LLMError('config', `provider "${name}" is already registered`, name)
    const info = provider?.egress
    if (!info || typeof info.host !== 'string' || !info.host.trim() || typeof info.remote !== 'boolean') {
      throw new LLMError('config', `provider "${name}" must declare egress metadata (host and remote flag)`, name)
    }
    this.providers.set(name, provider)
    this.providerEgress.set(name, Object.freeze({ host: info.host, remote: info.remote }))
    if (opts.default) this.defaultName = name
    return () => {
      if (this.providers.get(name) === provider) {
        this.providers.delete(name)
        this.providerEgress.delete(name)
      }
      if (this.defaultName === name) this.defaultName = undefined
    }
  }

  /** The budget gate every call passes through, if any (ARCH-03). Read `status()` from it; `resetTask()` between tasks. */
  get budget(): BudgetGate | undefined {
    return this.gate
  }

  /** Attach a gate built elsewhere (e.g. one that shares its `Budgets` with the CLI). Returns a disposer. */
  useBudget(gate: BudgetGate): () => void {
    if (this.gate) throw new LLMError('config', 'a budget gate is already attached to ctx.llm', '(none)')
    this.gate = gate
    return () => {
      if (this.gate === gate) this.gate = undefined
    }
  }

  list(): string[] {
    return [...this.providers.keys()]
  }

  async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse> {
    // Snapshot at entry so an async consent check cannot make the logged prompt
    // differ from the request eventually sent to the provider.
    const request = structuredClone(req)
    if (request.maxTokens !== undefined && (!Number.isSafeInteger(request.maxTokens) || request.maxTokens <= 0)) {
      throw new LLMError('config', 'model request: maxTokens must be a positive safe integer', request.provider ?? this.defaultName ?? '(none)')
    }
    const name = request.provider ?? this.defaultName
    if (!name) throw new LLMError('config', 'no provider specified and no default configured', '(none)')
    const provider = this.providers.get(name)
    if (!provider) {
      throw new LLMError('config', `unknown provider "${name}" (registered: ${this.list().join(', ') || 'none'})`, name)
    }

    const { sessionId, provider: _p, actor, ...rest } = request
    const log = this.ctx.log
    const egress = this.providerEgress.get(name)
    if (!egress) throw new LLMError('config', `provider "${name}" has no validated egress metadata`, name)

    if (egress.remote) {
      // Two independent gates, both required (1B.1, D-029): this binding must be configured
      // to attempt remote calls (`egressConsent`, D-022) AND the project must have an actual,
      // persisted consent record — a project that was never asked sends nothing, whatever
      // this binding's own config says.
      const projectConsented = await this.ctx.egress.hasConsent()
      if (!projectConsented || !this.egressConsent) {
        const reason = !projectConsented ? 'no_project_consent' : 'no_egress_consent'
        const message = !projectConsented
          ? `${name}: refused to send to ${egress.host} - no consent record for this project. Call \`ctx.egress.grantConsent()\` after the user accepts.`
          : `${name}: refused to send to ${egress.host} without egress consent. Set \`egress: { consent: true }\` after the user accepts.`
        await log.append(sessionId, 'model.blocked', { provider: name, host: egress.host, reason }, actor)
        throw new LLMError('consent', message, name)
      }
      try {
        this.ctx.egress.assertAllowedHost(egress.host)
      } catch (e) {
        const message = e instanceof EgressError ? e.message : String(e)
        await log.append(sessionId, 'model.blocked', { provider: name, host: egress.host, reason: 'endpoint_not_allowed' }, actor)
        throw new LLMError('consent', message, name)
      }
    }

    // Redact known secrets (1B.1) before the payload is ever logged or sent - a seeded
    // secret riding along in message content or tool output must not reach either place.
    const redacted = this.ctx.egress.redactValue(rest)

    // ARCH-03: hold budget BEFORE anything is logged as sent or leaves the process. A call that cannot fit is refused here.
    let reservation: CallReservation | undefined
    if (this.gate) {
      try {
        reservation = this.gate.reserve(redacted)
      } catch (e) {
        if (!(e instanceof BudgetExceededError)) throw e
        await log.append(sessionId, 'budget.blocked', { provider: name, metric: e.metric, scope: e.scope, status: e.status }, actor)
        throw new LLMError('budget', e.message, name)
      }
    }
    const book = async (usage: { inputTokens: number; outputTokens: number } | undefined, failed: boolean, dispatched = true) => {
      if (!reservation) return
      if (!dispatched) {
        reservation.release()
        return
      }
      const spent = failed ? reservation.fail() : reservation.settle(usage)
      const soft = spent.flatMap((r) => r.newlySoftBreached)
      if (soft.length) await log.append(sessionId, 'budget.warning', { provider: name, softBreached: soft }, actor).catch(() => {})
    }

    // Log first; fail closed. Remote calls also record where the data goes and how much.
    const egressLog = egress ? { egress: { host: egress.host, remote: egress.remote, bytes: Buffer.byteLength(JSON.stringify(redacted)) } } : {}
    try {
      await log.append(sessionId, 'model.request', { provider: name, ...redacted, ...egressLog }, actor)
    } catch (e) {
      // Not sent, so not spent: give the hold back and let the log failure stop the call as before.
      if (reservation) await book(undefined, true, false).catch(() => {})
      throw e
    }

    let dispatchStarted = false
    const dispatch = () => {
      // The limiter has checked cancellation while waiting. Once it consumes a quota slot,
      // invoke the provider even if the signal just fired; the provider receives the signal.
      if (!this.limiter) signal?.throwIfAborted()
      dispatchStarted = true
      return provider.complete(redacted, signal)
    }
    try {
      const res = await (this.limiter ? this.limiter.run(dispatch, signal) : dispatch())
      const out: CompletionResponse = { provider: name, ...res }
      await book(out.usage, false)
      await log.append(
        sessionId,
        'model.response',
        { provider: name, model: out.model, text: out.text, toolCalls: out.toolCalls, stopReason: out.stopReason, usage: out.usage, ...(out.recoveredToolCalls ? { recoveredToolCalls: out.recoveredToolCalls } : {}) },
        actor,
      )
      return out
    } catch (e: any) {
      const err = e instanceof LLMError ? e : new LLMError('unknown', `${name}: ${e?.message ?? String(e)}`, name)
      await book(undefined, true, dispatchStarted) // only charge a failed request after provider dispatch began
      await log.append(sessionId, 'model.error', { provider: name, kind: err.kind, status: err.status, message: err.message }, actor)
      throw err
    }
  }
}

export const name = 'bundle-model-adapter'
export function apply(ctx: Context, config: ModelAdapterConfig = {}) {
  ctx.plugin(LLMService, config)
}
