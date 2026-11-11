import { Context, Service } from 'cordis'
import '../model-adapter/index.js'
import '../tool-registry/index.js'
import { looksLikePseudoToolCall, looksLikeToolResultBoilerplate } from './response-guards.js'
import { LLMError, type CompletionResponse, type ContentBlock, type Message, type ToolSpec } from '../model-adapter/index.js'
import {
  AgentLoopError,
  textOf,
  type AgentLoopConfig,
  type RetryConfig,
  type RunResult,
  type RunTaskOptions,
  type SystemSectionProvider,
  type ToolRouter,
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
    if (signal?.aborted) onAbort() // AbortSignal does not replay an earlier abort to a late listener.
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
  private readonly sections: { name: string; order: number; provider: SystemSectionProvider }[] = []
  private router?: ToolRouter

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
    if (!Number.isSafeInteger(this.maxSteps) || this.maxSteps < 1) throw new AgentLoopError('agent-loop: maxSteps must be a positive safe integer')
    if (!Number.isSafeInteger(this.retry.maxAttempts) || this.retry.maxAttempts < 0 ||
      !Number.isFinite(this.retry.baseDelayMs) || this.retry.baseDelayMs < 0 ||
      !Number.isFinite(this.retry.factor) || this.retry.factor < 1 ||
      !Number.isFinite(this.retry.maxDelayMs) || this.retry.maxDelayMs < 0) {
      throw new AgentLoopError('agent-loop: retry maxAttempts must be a non-negative safe integer; delays must be finite and non-negative; factor must be finite and at least 1')
    }
  }

  /**
   * Let another bundle add text to every run's system prompt (3.2: hot memory).
   * Sections follow the base system prompt, lowest `order` first (default 100,
   * ties in registration order). Providers run once per run, before the first
   * model call, so a change made before the next run is seen by that run and a
   * change made mid-run is not. A provider that throws fails the run: silently
   * dropping a section would leave the model without rules it is assumed to
   * have. Returns a function that removes the section.
   */
  addSystemSection(name: string, provider: SystemSectionProvider, opts: { order?: number } = {}): () => void {
    if (this.sections.some((s) => s.name === name)) throw new AgentLoopError(`agent-loop: system section "${name}" is already registered`)
    const entry = { name, order: opts.order ?? 100, provider }
    this.sections.push(entry)
    return () => {
      const i = this.sections.indexOf(entry)
      if (i >= 0) this.sections.splice(i, 1)
    }
  }

  /**
   * ARCH-02: attach the router. Returns a disposer. With no router, or a router that owns nothing and is not shadowing,
   * the loop behaves exactly as before and makes no router call at all (so no extra request).
   */
  useRouter(router: ToolRouter): () => void {
    this.router = router
    return () => {
      if (this.router === router) this.router = undefined
    }
  }

  /**
   * The router's one decision point (ARCH-02), first model call of a run only. Among the READ-ONLY tools offered (the router is never
   * shown a tool that writes, runs commands or spends), an owning router may narrow them to its pick; the model still sees every
   * other tool unchanged, so the router can only narrow, never widen, and the policy gates still run on whatever the model calls.
   * Not owning: if shadowing, record Needle's pick for comparison and change nothing.
   */
  private async routeFirstStep(opts: RunTaskOptions, toolSpecs: ToolSpec[]): Promise<{ tools: ToolSpec[]; shadowChoice?: string | null }> {
    const r = this.router
    if (!r) return { tools: toolSpecs }
    const classOf = new Map(this.ctx.tools.list().map((t) => [t.name, t.actionClass]))
    const readOnly = toolSpecs.filter((t) => classOf.get(t.name) === 'read-only')
    if (readOnly.length < 2) return { tools: toolSpecs } // nothing to choose between
    const req = { task: opts.prompt, sessionId: opts.sessionId, candidates: readOnly.map((t) => ({ id: t.name, description: t.description, allowed: true })) }
    const actor = opts.actor ?? 'agent-loop'
    if (r.owns('tool')) {
      const d = await r.decide('tool', req)
      if (!d.choice) return { tools: toolSpecs } // abstained or failed: the model chooses, as without a router
      await this.ctx.log.append(opts.sessionId, 'router.applied', { class: 'tool', choice: d.choice, source: d.source, offered: readOnly.map((t) => t.name) }, actor)
      return { tools: toolSpecs.filter((t) => classOf.get(t.name) !== 'read-only' || t.name === d.choice) }
    }
    if (r.shadowTool) {
      const d = await r.shadow('tool', req)
      await this.ctx.log.append(opts.sessionId, 'router.shadow', { class: 'tool', needle: d.choice, latencyMs: d.latencyMs, skipped: d.skipped.map((x) => x.why), offered: readOnly.map((t) => t.name) }, actor)
      return { tools: toolSpecs, shadowChoice: d.choice }
    }
    return { tools: toolSpecs }
  }

  private async buildSystem(base: string | undefined, sessionId: string, prompt: string, actor?: string): Promise<string | undefined> {
    const parts: string[] = base ? [base] : []
    const ordered = this.sections.map((s, i) => ({ s, i })).sort((a, b) => a.s.order - b.s.order || a.i - b.i)
    for (const { s } of ordered) {
      const text = await s.provider({ sessionId, prompt, ...(actor ? { actor } : {}) })
      if (text) parts.push(text)
    }
    return parts.length ? parts.join('\n\n') : undefined
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
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) throw new AgentLoopError('agent-loop: run maxSteps must be a positive safe integer')
    const reflectionOn = opts.reflection ?? this.reflection
    const model = opts.model ?? this.model
    const system = await this.buildSystem(opts.system ?? this.system, opts.sessionId, opts.prompt, opts.actor)

    const messages: Message[] = [{ role: 'user', content: opts.prompt }]
    let steps = 0
    let retries = 0
    let reflected = false
    let requestedReflection = false
    let requiredSequenceFinalizationRetried = false
    let routed: { tools: ToolSpec[]; shadowChoice?: string | null } = { tools: toolSpecs }

    while (steps < maxSteps) {
      opts.signal?.throwIfAborted()
      if (steps === 0) routed = await this.routeFirstStep(opts, toolSpecs)
      // Once the caller's ordered tool sequence is complete, move into a
      // tool-free finalization phase. The registry remains the enforcement
      // boundary if a provider emits a tool call anyway.
      const sequenceComplete = opts.requiredToolSequence !== undefined &&
        opts.requiredToolSequence.state.nextIndex >= opts.requiredToolSequence.tools.length
      const stepTools = sequenceComplete ? [] : (steps === 0 ? routed.tools : toolSpecs)

      const { res, retries: r } = await this.callModel(
        { sessionId: opts.sessionId, ...(opts.actor ? { actor: opts.actor } : {}), messages, ...(system ? { system } : {}), ...(stepTools.length ? { tools: stepTools } : {}), ...(model ? { model } : {}), ...(opts.jsonSchema ? { jsonSchema: opts.jsonSchema } : {}) },
        providerChain,
        opts.signal,
      )
      retries += r
      steps++
      opts.signal?.throwIfAborted()
      messages.push({ role: 'assistant', content: res.content })
      if (steps === 1 && routed.shadowChoice !== undefined) {
        const picked = res.toolCalls[0]?.name ?? null
        await this.ctx.log.append(opts.sessionId, 'router.shadow.result', { needle: routed.shadowChoice, worker: picked, agreed: routed.shadowChoice !== null && picked === routed.shadowChoice }, opts.actor ?? 'agent-loop')
      }

      if (res.toolCalls.length === 0) {
        const nextRequiredTool = opts.requiredToolSequence?.tools[opts.requiredToolSequence.state.nextIndex]
        if (nextRequiredTool !== undefined) {
          messages.push({
            role: 'user',
            content: `The required tool sequence is incomplete. You must call "${nextRequiredTool}" next. Do not provide a final answer until every required tool call has been attempted.`,
          })
          continue
        }
        const finalText = textOf(res.content)
        if (opts.requiredToolSequence && (looksLikePseudoToolCall(finalText) || looksLikeToolResultBoilerplate(finalText))) {
          if (requiredSequenceFinalizationRetried) return { stopReason: 'max_steps', messages, finalText: '', steps, retries, reflected }
          requiredSequenceFinalizationRetried = true
          messages.push({
            role: 'user',
            content: 'All required tool calls have already been completed. Your previous reply repeated tool-call syntax or tool-result safety metadata instead of answering. Do not call, name, or describe tools, and do not repeat the warning text. Use the tool results already in this conversation to answer the original user request directly. If the results do not support an answer, say what is missing.',
          })
          continue
        }
        if (reflectionOn && !requestedReflection) {
          requestedReflection = true
          reflected = true
          messages.push({
            role: 'user',
            content: 'Double-check your previous answer for completeness and correctness. Reply with the corrected final answer if anything was wrong, or restate it unchanged if it was already right.',
          })
          continue
        }
        return { stopReason: 'done', messages, finalText, steps, retries, reflected }
      }

      const resultBlocks: ContentBlock[] = []
      for (const call of res.toolCalls) {
        opts.signal?.throwIfAborted()
        const result = await this.ctx.tools.call(call.name, call.input, { sessionId: opts.sessionId, ...(opts.actor ? { actor: opts.actor } : {}), allowedTools: toolNames, ...(opts.requiredToolSequence ? { requiredToolSequence: opts.requiredToolSequence } : {}), ...(opts.signal ? { signal: opts.signal } : {}) })
        resultBlocks.push({ type: 'tool_result', toolUseId: call.id, content: result.content, isError: !result.ok })
      }
      messages.push({ role: 'user', content: resultBlocks })

      // A provider may keep emitting calls after the required sequence is
      // complete and no tools are offered. Reject the attempted calls through
      // the registry once, then stop instead of retrying until maxSteps.
      if (sequenceComplete) {
        // The model attempted another tool after the required sequence. The
        // attempt was blocked, but that does not mean the user's task was
        // completed. Fail closed so the orchestrator cannot accept a
        // success-shaped placeholder as the subtask result.
        return { stopReason: 'max_steps', messages, finalText: '', steps, retries, reflected }
      }
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
          const res = await this.ctx.llm.complete({ ...req, ...(providerName !== undefined ? { provider: providerName } : {}) }, signal)
          return { res, retries }
        } catch (e) {
          lastErr = e
          // The budget is shared by every provider: trying the next one would only spend another refusal.
          if (e instanceof LLMError && e.kind === 'budget') throw e
          if (!(e instanceof LLMError) || !e.retryable || attempt >= this.retry.maxAttempts) break
          const suggested = e.retryAfterMs
          const backoff = Math.min(this.retry.maxDelayMs, this.retry.baseDelayMs * this.retry.factor ** attempt)
          const delay = typeof suggested === 'number' && Number.isFinite(suggested) && suggested >= 0 ? suggested : backoff
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
