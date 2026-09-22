import { Context, Service } from 'cordis'
import '../session-log/index.js'
import { OllamaProvider, type OllamaConfig } from './providers/ollama.js'
import { OpenAICompatibleProvider, type OpenAICompatibleConfig } from './providers/openai-compatible.js'
import { LLMError, type CompletionRequest, type CompletionResponse, type LLMProvider } from './types.js'

export * from './types.js'
export { OllamaProvider, resolveBaseUrl, type OllamaConfig } from './providers/ollama.js'
export { OpenAICompatibleProvider, type OpenAICompatibleConfig } from './providers/openai-compatible.js'
export { MockProvider } from './providers/mock.js'
export { RateLimiter, type RateLimiterConfig } from './rate-limiter.js'

export interface ModelAdapterConfig {
  /** Name of the provider used when a request doesn't name one. */
  default?: string
  /** Built-in Ollama provider; registered as `ollama` when present. */
  ollama?: OllamaConfig
  /** Built-in OpenAI-compatible provider (OpenRouter and similar); registered under `name`. */
  openaiCompatible?: OpenAICompatibleConfig
  /**
   * Consent to send prompts to non-loopback hosts (D-022). Without `consent: true`
   * every remote provider call is refused before anything leaves the machine.
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
  static inject = ['log']
  private providers = new Map<string, LLMProvider>()
  private defaultName?: string
  private readonly egressConsent: boolean

  constructor(ctx: Context, config: ModelAdapterConfig = {}) {
    super(ctx, 'llm')
    this.defaultName = config.default
    this.egressConsent = config.egress?.consent === true
    if (config.ollama) {
      this.providers.set('ollama', new OllamaProvider(config.ollama))
      this.defaultName ??= 'ollama'
    }
    if (config.openaiCompatible) {
      const name = config.openaiCompatible.name ?? 'openai-compatible'
      this.providers.set(name, new OpenAICompatibleProvider({ ...config.openaiCompatible, name }))
      this.defaultName ??= name
    }
  }

  /** Register a provider. Returns a disposer; use inside `ctx.effect` so it unregisters with its plugin. */
  register(name: string, provider: LLMProvider, opts: { default?: boolean } = {}): () => void {
    if (this.providers.has(name)) throw new LLMError('config', `provider "${name}" is already registered`, name)
    this.providers.set(name, provider)
    if (opts.default) this.defaultName = name
    return () => {
      if (this.providers.get(name) === provider) this.providers.delete(name)
      if (this.defaultName === name) this.defaultName = undefined
    }
  }

  list(): string[] {
    return [...this.providers.keys()]
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const name = req.provider ?? this.defaultName
    if (!name) throw new LLMError('config', 'no provider specified and no default configured', '(none)')
    const provider = this.providers.get(name)
    if (!provider) {
      throw new LLMError('config', `unknown provider "${name}" (registered: ${this.list().join(', ') || 'none'})`, name)
    }

    const { sessionId, provider: _p, actor, ...rest } = req
    const log = this.ctx.log

    // Egress consent (D-022): a remote host needs explicit consent before anything is sent.
    const egress = provider.egress
    if (egress?.remote && !this.egressConsent) {
      const message = `${name}: refused to send to ${egress.host} without egress consent. Set \`egress: { consent: true }\` after the user accepts.`
      await log.append(sessionId, 'model.blocked', { provider: name, host: egress.host, reason: 'no_egress_consent' }, actor)
      throw new LLMError('consent', message, name)
    }

    // Log first; fail closed. Remote calls also record where the data goes and how much.
    const egressLog = egress ? { egress: { host: egress.host, remote: egress.remote, bytes: Buffer.byteLength(JSON.stringify(rest)) } } : {}
    await log.append(sessionId, 'model.request', { provider: name, ...rest, ...egressLog }, actor)

    try {
      const res = await provider.complete(rest)
      const out: CompletionResponse = { provider: name, ...res }
      await log.append(
        sessionId,
        'model.response',
        { provider: name, model: out.model, text: out.text, toolCalls: out.toolCalls, stopReason: out.stopReason, usage: out.usage },
        actor,
      )
      return out
    } catch (e: any) {
      const err = e instanceof LLMError ? e : new LLMError('unknown', `${name}: ${e?.message ?? String(e)}`, name)
      await log.append(sessionId, 'model.error', { provider: name, kind: err.kind, status: err.status, message: err.message }, actor)
      throw err
    }
  }
}

export const name = 'bundle-model-adapter'
export function apply(ctx: Context, config: ModelAdapterConfig = {}) {
  ctx.plugin(LLMService, config)
}
