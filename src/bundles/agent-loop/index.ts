import { Context, Service } from 'cordis'
import '../model-adapter/index.js'
import '../tool-registry/index.js'
import { LLMError, type CompletionResponse, type ContentBlock, type Message, type ToolSpec } from '../model-adapter/index.js'
import {
  AgentLoopError,
  textOf,
  type AgentLoopConfig,
  type RetryConfig,
  type RunResult,
  type RunTaskOptions,
} from './types.js'

export * from './types.js'

declare module 'cordis' {
  interface Context {
    agentLoop: AgentLoop
  }
}

const DEFAULT_RETRY: Required<RetryConfig> = { maxAttempts: 2, baseDelayMs: 500, factor: 2, maxDelayMs: 30_000 }

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(signal!.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * `ctx.agentLoop` — a ReAct loop over `ctx.llm` and `ctx.tools` (1.5,
 * `docs/architecture.md` `bundle-agent-loop`). Registered here as a single
 * top-level service rather than nested under a `ctx.agents.*` namespace:
 * `docs/architecture.md`'s `ctx.agents.loop` label described the intended
 * capability, not a literal cordis key, and there is no orchestrator yet
 * (Phase 4) to compose multiple agents under one namespace. If Phase 4
 * needs that nesting it can wrap this service rather than the other way
 * round.
 *
 * The loop never retries or falls back on its own initiative for reasoning
 * — `ctx.llm.complete()` explicitly does not retry (D-023's own comment on
 * `LLMService`) — so that policy has to live somewhere, and this is that
 * somewhere: retry decisions follow `LLMError.retryable` and `retryAfterMs`
 * exactly as D-023 specifies, never re-deriving the classification.
 *
 * Every model call and tool call is already logged by `ctx.llm` and
 * `ctx.tools` themselves (`model.request/response/error`,
 * `tool.call/tool.result`) — this bundle logs nothing extra, so the "every
 * reasoning step is logged" requirement holds structurally rather than by
 * a second, parallel logging path that could drift from the first.
 */
export class AgentLoop extends Service {
  static inject = ['log', 'llm', 'tools']

  private readonly maxSteps: number
  private readonly reflection: boolean
  private readonly provider?: string
  private readonly fallbackProviders: string[]
  private readonly model?: string
  private readonly system?: string
  private readonly retry: Required<RetryConfig>
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>

  constructor(ctx: Context, config: AgentLoopConfig = {}) {
    super(ctx, 'agentLoop')
    this.maxSteps = config.maxSteps ?? 10
    this.reflection = config.reflection ?? false
    if (config.provider !== undefined) this.provider = config.provider
    this.fallbackProviders = config.fallbackProviders ?? []
    if (config.model !== undefined) this.model = config.model
    if (config.system !== undefined) this.system = config.system
    this.retry = { ...DEFAULT_RETRY, ...config.retry }
    this.sleep = config.sleep ?? defaultSleep
    if (this.maxSteps < 1) throw new AgentLoopError('agent-loop: maxSteps must be at least 1')
  }

  async run(opts: RunTaskOptions): Promise<RunResult> {
    const toolNames = opts.tools ?? this.ctx.tools.list().map((t) => t.name)
    for (const n of toolNames) {
      if (!this.ctx.tools.has(n)) throw new AgentLoopError(`agent-loop: task named tool "${n}" but no such tool is registered`)
    }
    const toolSpecs: ToolSpec[] = toolNames.map((n) => {
      const t = this.ctx.tools.list().find((x) => x.name === n)!
      return { name: t.name, description: t.description, inputSchema: t.inputSchema }
    })

    const providerChain = [opts.provider ?? this.provider, ...(opts.fallbackProviders ?? this.fallbackProviders)]
    const maxSteps = opts.maxSteps ?? this.maxSteps
    const reflectionOn = opts.reflection ?? this.reflection
    const model = opts.model ?? this.model
    const system = opts.system ?? this.system

    const messages: Message[] = [{ role: 'user', content: opts.prompt }]
    let steps = 0
    let retries = 0
    let reflected = false
    let requestedReflection = false

    while (steps < maxSteps) {
      opts.signal?.throwIfAborted()

      const { res, retries: r } = await this.callModel(
        { sessionId: opts.sessionId, ...(opts.actor ? { actor: opts.actor } : {}), messages, ...(system ? { system } : {}), ...(toolSpecs.length ? { tools: toolSpecs } : {}), ...(model ? { model } : {}) },
        providerChain,
        opts.signal,
      )
      retries += r
      steps++
      messages.push({ role: 'assistant', content: res.content })

      if (res.toolCalls.length === 0) {
        if (reflectionOn && !requestedReflection) {
          requestedReflection = true
          reflected = true
          messages.push({
            role: 'user',
            content: 'Double-check your previous answer for completeness and correctness. Reply with the corrected final answer if anything was wrong, or restate it unchanged if it was already right.',
          })
          continue
        }
        return { stopReason: 'done', messages, finalText: textOf(res.content), steps, retries, reflected }
      }

      const resultBlocks: ContentBlock[] = []
      for (const call of res.toolCalls) {
        const result = await this.ctx.tools.call(call.name, call.input, { sessionId: opts.sessionId, ...(opts.actor ? { actor: opts.actor } : {}) })
        resultBlocks.push({ type: 'tool_result', toolUseId: call.id, content: result.content, isError: !result.ok })
      }
      messages.push({ role: 'user', content: resultBlocks })
    }

    return { stopReason: 'max_steps', messages, finalText: '', steps, retries, reflected }
  }

  /**
   * Tries `chain` in order. On each provider: retry a `retryable` error up
   * to `retry.maxAttempts` more times (honoring `retryAfterMs` when the
   * provider sent one), then move on. A non-retryable error moves on
   * immediately — retrying a spent quota only wastes another request
   * against it (D-023). Throws the last error once every provider in the
   * chain is exhausted.
   */
  private async callModel(
    req: Parameters<Context['llm']['complete']>[0],
    chain: (string | undefined)[],
    signal?: AbortSignal,
  ): Promise<{ res: CompletionResponse; retries: number }> {
    let lastErr: unknown
    let retries = 0
    for (const providerName of chain) {
      let attempt = 0
      for (;;) {
        try {
          const res = await this.ctx.llm.complete({ ...req, ...(providerName !== undefined ? { provider: providerName } : {}) })
          return { res, retries }
        } catch (e) {
          lastErr = e
          if (!(e instanceof LLMError) || !e.retryable || attempt >= this.retry.maxAttempts) break
          const delay = e.retryAfterMs ?? Math.min(this.retry.maxDelayMs, this.retry.baseDelayMs * this.retry.factor ** attempt)
          attempt++
          retries++
          await this.sleep(Math.min(delay, this.retry.maxDelayMs), signal)
        }
      }
    }
    throw lastErr
  }
}

export const name = 'bundle-agent-loop'
export function apply(ctx: Context, config: AgentLoopConfig = {}) {
  ctx.plugin(AgentLoop, config)
}
