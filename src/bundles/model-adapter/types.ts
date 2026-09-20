/** Content blocks, shaped so native tool-use (Phase 1.5) needs no interface change. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

export interface Message {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>
}

export interface CompletionRequest {
  /**
   * REQUIRED on purpose: the adapter logs every request/response to this
   * session, so "model-visible = logged" is structural, not a convention.
   */
  sessionId: string
  messages: Message[]
  system?: string
  tools?: ToolSpec[]
  /** Overrides the provider's configured model for this call. */
  model?: string
  maxTokens?: number
  temperature?: number
  /** Named provider registered on ctx.llm; defaults to the service default. */
  provider?: string
  /** Attribution for the session log (agent id, bundle name). */
  actor?: string
}

export interface ToolCall {
  id: string
  name: string
  input: unknown
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'other'

export interface CompletionResponse {
  provider: string
  model: string
  /** Concatenated text blocks. */
  text: string
  content: ContentBlock[]
  toolCalls: ToolCall[]
  stopReason: StopReason
  usage: { inputTokens: number; outputTokens: number }
}

/** What a provider receives: the request minus routing/logging fields. */
export type ProviderRequest = Omit<CompletionRequest, 'sessionId' | 'provider' | 'actor'>

/** The whole plug-and-play contract. A new provider implements only this. */
export interface LLMProvider {
  complete(req: ProviderRequest, signal?: AbortSignal): Promise<Omit<CompletionResponse, 'provider'>>
}

export type LLMErrorKind =
  | 'config'
  | 'auth'
  | 'rate_limit'
  | 'invalid_request'
  | 'server'
  | 'network'
  | 'timeout'
  | 'unknown'

export class LLMError extends Error {
  override name = 'LLMError'
  constructor(
    public kind: LLMErrorKind,
    message: string,
    public provider: string,
    public status?: number,
  ) {
    super(message)
  }
  /** Caller policy hint only; the adapter itself does not retry. */
  get retryable() {
    return this.kind === 'rate_limit' || this.kind === 'server' || this.kind === 'network' || this.kind === 'timeout'
  }
}
