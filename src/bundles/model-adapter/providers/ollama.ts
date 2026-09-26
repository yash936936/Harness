import { randomUUID } from 'node:crypto'
import {
  LLMError,
  type ContentBlock,
  type EgressInfo,
  type LLMProvider,
  type Message,
  type ProviderRequest,
  type StopReason,
} from '../types.js'

export interface OllamaConfig {
  /** Required, e.g. an installed model tag. No default: model choice is configuration. */
  model: string
  /** Falls back to OLLAMA_HOST, then http://localhost:11434. */
  baseUrl?: string
  /** Local models can be slow on first load; default 120s. */
  timeoutMs?: number
  /** Injectable for tests. */
  fetch?: typeof fetch
}

const NAME = 'ollama'

export function resolveBaseUrl(explicit?: string): string {
  let url = explicit ?? process.env['OLLAMA_HOST'] ?? 'http://localhost:11434'
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`
  return url.replace(/\/+$/, '')
}

export class OllamaProvider implements LLMProvider {
  readonly egress: EgressInfo
  private readonly model: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly doFetch: typeof fetch

  constructor(config: OllamaConfig) {
    if (!config.model) throw new LLMError('config', 'ollama: `model` is required in config', NAME)
    this.model = config.model
    this.baseUrl = resolveBaseUrl(config.baseUrl)
    const host = new URL(this.baseUrl).hostname
    this.egress = { host, remote: !/^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/i.test(host) }
    this.timeoutMs = config.timeoutMs ?? 120_000
    this.doFetch = config.fetch ?? fetch
  }

  /** `GET /api/tags` - installed model tags. Throws on failure; callers treat listing as best-effort. */
  async listModels(signal?: AbortSignal): Promise<string[]> {
    let res: Response
    try {
      res = await this.doFetch(`${this.baseUrl}/api/tags`, { signal })
    } catch (e: any) {
      const code = e?.cause?.code ?? e?.message ?? 'unknown'
      throw new LLMError('network', `ollama: cannot reach ${this.baseUrl} (${code})`, NAME)
    }
    if (!res.ok) throw new LLMError('server', `ollama: could not list models (HTTP ${res.status})`, NAME, res.status)
    const json: any = await res.json().catch(() => undefined)
    const models = Array.isArray(json?.models) ? json.models : []
    return models.map((m: any) => String(m?.name ?? m?.model ?? '')).filter(Boolean)
  }

  async complete(req: ProviderRequest, outer?: AbortSignal) {
    const model = req.model ?? this.model
    const options: Record<string, unknown> = {}
    if (req.temperature !== undefined) options['temperature'] = req.temperature
    if (req.maxTokens !== undefined) options['num_predict'] = req.maxTokens

    const body: Record<string, unknown> = {
      model,
      stream: false,
      messages: toWireMessages(req),
      ...(Object.keys(options).length ? { options } : {}),
    }
    if (req.tools?.length) {
      body['tools'] = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }))
    }

    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = outer ? AbortSignal.any([outer, timeout]) : timeout

    let res: Response
    try {
      res = await this.doFetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
    } catch (e: any) {
      if (timeout.aborted) throw new LLMError('timeout', `ollama: no response within ${this.timeoutMs}ms (large model still loading?)`, NAME)
      if (outer?.aborted) throw e
      const code = e?.cause?.code ?? e?.message ?? 'unknown'
      throw new LLMError('network', `ollama: cannot reach ${this.baseUrl} (${code}). Is Ollama running? Start it with \`ollama serve\`.`, NAME)
    }

    const raw = await res.text()
    let json: any
    try {
      json = JSON.parse(raw)
    } catch {
      json = undefined
    }

    if (!res.ok) throw httpError(res.status, String(json?.error ?? raw.slice(0, 200)), model)

    const msg = json?.message
    if (!msg || typeof msg !== 'object') {
      throw new LLMError('server', 'ollama: malformed response (no message)', NAME, res.status)
    }

    const content: ContentBlock[] = []
    if (typeof msg.content === 'string' && msg.content.length) content.push({ type: 'text', text: msg.content })
    for (const tc of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
      const fn = tc?.function
      if (!fn?.name) continue
      content.push({ type: 'tool_use', id: `call_${randomUUID().slice(0, 8)}`, name: fn.name, input: parseArgs(fn.arguments) })
    }
    const toolCalls = content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : []))
    return {
      model: String(json.model ?? model),
      text: content.map((b) => (b.type === 'text' ? b.text : '')).join(''),
      content,
      toolCalls,
      stopReason: mapStop(json.done_reason, toolCalls.length > 0),
      usage: { inputTokens: json.prompt_eval_count ?? 0, outputTokens: json.eval_count ?? 0 },
    }
  }
}

function parseArgs(a: unknown): unknown {
  if (typeof a === 'string') {
    try { return JSON.parse(a) } catch { return { _raw: a } }
  }
  return a ?? {}
}

function mapStop(reason: unknown, hasTools: boolean): StopReason {
  if (hasTools) return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  if (reason === 'stop' || reason === undefined) return 'end_turn'
  return 'other'
}

/** Anthropic-style blocks -> Ollama chat messages. */
function toWireMessages(req: ProviderRequest): unknown[] {
  const out: unknown[] = []
  if (req.system) out.push({ role: 'system', content: req.system })

  // Ollama tool results are matched by tool name, so remember id -> name from history.
  const names = new Map<string, string>()
  for (const m of req.messages) {
    if (typeof m.content !== 'string') for (const b of m.content) if (b.type === 'tool_use') names.set(b.id, b.name)
  }

  for (const m of req.messages as Message[]) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content })
      continue
    }
    const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    if (m.role === 'assistant') {
      const calls = m.content.flatMap((b) =>
        b.type === 'tool_use' ? [{ function: { name: b.name, arguments: b.input } }] : [],
      )
      out.push({ role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls } : {}) })
    } else {
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          out.push({ role: 'tool', tool_name: names.get(b.toolUseId) ?? 'unknown', content: b.content })
        }
      }
      if (text) out.push({ role: 'user', content: text })
    }
  }
  return out
}

function httpError(status: number, detail: string, model: string) {
  const d = detail ? `: ${detail}` : ''
  if (status === 404) {
    return new LLMError('invalid_request', `ollama: model "${model}" not available${d}. Install it with \`ollama pull ${model}\`.`, NAME, status)
  }
  if (status >= 500) return new LLMError('server', `ollama: server error (HTTP ${status})${d}`, NAME, status)
  return new LLMError('invalid_request', `ollama: request rejected (HTTP ${status})${d}`, NAME, status)
}
