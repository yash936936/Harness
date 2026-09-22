import type { ContentBlock, Message } from '../model-adapter/index.js'

export interface RetryConfig {
  /** Extra attempts after the first, for a retryable error on the SAME provider. Default 2. */
  maxAttempts?: number
  /** Backoff base in ms, used only when the provider gave no `retryAfterMs`. Default 500. */
  baseDelayMs?: number
  /** Exponential multiplier per attempt. Default 2. */
  factor?: number
  /** Upper bound on any computed or server-suggested delay. Default 30,000. */
  maxDelayMs?: number
}

export interface AgentLoopConfig {
  /** Upper bound on model calls in one run, so a non-terminating task still stops. Default 10. */
  maxSteps?: number
  /** After a text-only (no tool calls) reply, ask the model to double-check itself once. Default false. */
  reflection?: boolean
  /** Starting provider name. Omit to use `ctx.llm`'s own default. */
  provider?: string
  /** Tried in order if the current provider fails without a fallback exhausting first (D-023). */
  fallbackProviders?: string[]
  model?: string
  system?: string
  retry?: RetryConfig
  /** Injectable for tests; default is a real `setTimeout`-based wait. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export interface RunTaskOptions {
  sessionId: string
  actor?: string
  /** The task, as the first user message. */
  prompt: string
  /** Registered tool names to expose for this run. Default: every tool currently registered. */
  tools?: string[]
  system?: string
  maxSteps?: number
  reflection?: boolean
  provider?: string
  fallbackProviders?: string[]
  model?: string
  signal?: AbortSignal
}

export type StopReason = 'done' | 'max_steps'

export interface RunResult {
  stopReason: StopReason
  /** Full transcript, including tool-result turns. */
  messages: Message[]
  /** Text of the last assistant turn. '' if the run stopped mid-tool-call at `max_steps`. */
  finalText: string
  /** Model calls that returned a response (successful ones only). */
  steps: number
  /** Retries actually taken across the whole run, summed over every provider tried. */
  retries: number
  /** True only when `reflection` was on and a self-check turn actually ran. */
  reflected: boolean
}

/** Config-time mistakes (an unregistered tool named, no provider available). Never a task outcome. */
export class AgentLoopError extends Error {
  override name = 'AgentLoopError'
}

export function textOf(content: ContentBlock[]): string {
  return content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
}
