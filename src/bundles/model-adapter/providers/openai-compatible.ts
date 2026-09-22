import { randomUUID } from 'node:crypto'
import type { RateLimiter } from '../rate-limiter.js'
import {
  LLMError,
  type ContentBlock,
  type EgressInfo,
  type LLMProvider,
  type Message,
  type ProviderRequest,
  type StopReason,
} from '../types.js'

export interface OpenAICompatibleConfig {
  /** Required. Pin an exact model ID; there is no default (model choice is configuration). */
  model: string
  /** Required, e.g. `https://openrouter.ai/api/v1`. `/chat/completions` is appended. */
  baseUrl: string
  /** Prefer `apiKeyEnv` so the key never sits in a config file. */
  apiKey?: string
  /** Name of the environment variable that holds the key. */
  apiKeyEnv?: string
  /** Provider name used in errors and logs. Default `openai-compatible`. */
  name?: string
  timeoutMs?: number
  /** Shared request limiter. Strongly recommended for free tiers (D-023). */
  limiter?: RateLimiter
  /** Injectable for tests. */
  fetch?: typeof fetch
}

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/i

export class OpenAICompatibleProvider implements LLMProvider {
  readonly egress: EgressInfo
  private readonly name: string
  private readonly model: string
  private readonly baseUrl: string
  private readonly apiKey?: string
  private readonly timeoutMs: number
  private readonly limiter?: RateLimiter
  private readonly doFetch: typeof fetch

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.name ?? 'openai-compatible'
    if (!config.model) throw new LLMError('config', `${this.name}: \`model\` is required in config`, this.name)
    if (!config.baseUrl) throw new LLMError('config', `${this.name}: \`baseUrl\` is required in config`, this.name)
    let url: URL
    try {
      url = new URL(config.baseUrl)
    } catch {
      throw new LLMError('config', `${this.name}: \`baseUrl\` is not a valid URL`, this.name)
    }
    this.model = config.model
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.egress = { host: url.hostname, remote: !LOOPBACK.test(url.hostname) }

    const fromEnv = config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined
    if (config.apiKeyEnv && !config.apiKey && !fromEnv) {
      throw new LLMError('config', `${this.name}: environment variable ${config.apiKeyEnv} is not set`, this.name)
    }
    const key = config.apiKey ?? fromEnv
    if (key) this.apiKey = key
    this.timeoutMs = config.timeoutMs ?? 120_000
    if (config.limiter) this.limiter = config.limiter
    this.doFetch = config.fetch ?? fetch
  }

  async complete(req: ProviderRequest, outer?: AbortSignal) {
    const call = () => this.send(req, outer)
    return this.limiter ? this.limiter.run(call, outer) : call()
  }

  private async send(req: ProviderRequest, outer?: AbortSignal) {
    const model = req.model ?? this.model
    const body: Record<string, unknown> = { model, stream: false, messages: toWireMessages(req) }
    if (req.maxTokens !== undefined) body['max_tokens'] = req.maxTokens
    if (req.temperature !== undefined) body['temperature'] = req.temperature
    if (req.tools?.length) {
      body['tools'] = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }))
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`

    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = outer ? AbortSignal.any([outer, timeout]) : timeout

    let res: Response
    try {
      res = await this.doFetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      })
    } catch (e: any) {
      if (timeout.aborted) throw new LLMError('timeout', `${this.name}: no response within ${this.timeoutMs}ms`, this.name)
      if (outer?.aborted) throw e
      const code = e?.cause?.code ?? e?.message ?? 'unknown'
      throw new LLMError('network', this.scrub(`${this.name}: cannot reach ${this.egress.host} (${code})`), this.name)
    }

    const raw = await res.text()
    let json: any
    try {
      json = JSON.parse(raw)
    } catch {
      json = undefined
    }

    if (!res.ok) {
      throw this.httpError(res.status, errorDetail(json, raw), res.headers.get('retry-after'))
    }
    // Some gateways answer HTTP 200 with an error body and no choices.
    if (json?.error && !json?.choices) {
      const code = Number(json.error.code)
      throw this.httpError(Number.isInteger(code) ? code : 502, errorDetail(json, raw), null)
    }

    const msg = json?.choices?.[0]?.message
    if (!msg || typeof msg !== 'object') {
      throw new LLMError('server', `${this.name}: malformed response (no choices[0].message)`, this.name, res.status)
    }

    const content: ContentBlock[] = []
    if (typeof msg.content === 'string' && msg.content.length) content.push({ type: 'text', text: msg.content })
    for (const tc of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
      const fn = tc?.function
      if (!fn?.name) continue
      content.push({
        type: 'tool_use',
        id: typeof tc.id === 'string' && tc.id ? tc.id : `call_${randomUUID().slice(0, 8)}`,
        name: fn.name,
        input: parseArgs(fn.arguments),
      })
    }
    const toolCalls = content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : []))
    return {
      model: String(json.model ?? model),
      text: content.map((b) => (b.type === 'text' ? b.text : '')).join(''),
      content,
      toolCalls,
      stopReason: mapStop(json.choices[0]?.finish_reason, toolCalls.length > 0),
      usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 },
    }
  }

  /** Keys must never reach the log or an error message, even if a server echoes them back. */
  private scrub(text: string): string {
    return this.apiKey ? text.split(this.apiKey).join('[redacted]') : text
  }

  private httpError(status: number, detail: string, retryAfter: string | null): LLMError {
    const d = detail ? `: ${this.scrub(detail)}` : ''
    const n = this.name
    if (status === 401 || status === 403) return new LLMError('auth', `${n}: authentication failed (HTTP ${status})${d}`, n, status)
    if (status === 402) return new LLMError('payment', `${n}: payment required, out of credit or negative balance (HTTP 402)${d}`, n, status)
    if (status === 429) {
      // Daily quota and congestion both arrive as 429. Retrying the first only wastes requests.
      if (/per[\s-]?day|daily|requests[\s-]?per[\s-]?day/i.test(detail)) {
        return new LLMError('quota', `${n}: daily quota exhausted (HTTP 429)${d}`, n, status)
      }
      const secs = retryAfter ? Number(retryAfter) : NaN
      const opts = Number.isFinite(secs) && secs >= 0 ? { retryAfterMs: secs * 1000 } : {}
      return new LLMError('rate_limit', `${n}: rate limited or provider congested (HTTP 429)${d}`, n, status, opts)
    }
    if (status >= 500) return new LLMError('server', `${n}: server error (HTTP ${status})${d}`, n, status)
    return new LLMError('invalid_request', `${n}: request rejected (HTTP ${status})${d}`, n, status)
  }
}

function errorDetail(json: any, raw: string): string {
  const m = json?.error?.message ?? json?.error ?? json?.message
  return typeof m === 'string' ? m.slice(0, 300) : raw.slice(0, 200)
}

function parseArgs(a: unknown): unknown {
  if (typeof a === 'string') {
    try { return JSON.parse(a) } catch { return { _raw: a } }
  }
  return a ?? {}
}

function mapStop(reason: unknown, hasTools: boolean): StopReason {
  if (hasTools || reason === 'tool_calls') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  if (reason === 'stop' || reason === undefined || reason === null) return 'end_turn'
  return 'other'
}

/** Anthropic-style blocks -> OpenAI chat messages. */
function toWireMessages(req: ProviderRequest): unknown[] {
  const out: unknown[] = []
  if (req.system) out.push({ role: 'system', content: req.system })
  for (const m of req.messages as Message[]) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content })
      continue
    }
    const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    if (m.role === 'assistant') {
      const calls = m.content.flatMap((b) =>
        b.type === 'tool_use'
          ? [{ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }]
          : [],
      )
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
    } else {
      for (const b of m.content) {
        if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.toolUseId, content: b.content })
      }
      if (text) out.push({ role: 'user', content: text })
    }
  }
  return out
}
