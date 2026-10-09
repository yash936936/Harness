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
  /**
   * Some models (observed: qwen2.5-coder:3b-instruct on the owner's machine, 2026-10-04) answer a tool request by
   * WRITING the call as text instead of using Ollama's tool-call field, so the loop sees a final answer and runs
   * nothing. With this on, a reply that is EXACTLY one tool call (raw JSON, a fenced block, or `<tool_call>` tags)
   * naming a tool offered in that request is turned into a real tool call. Anything else stays text. Default off:
   * it changes what counts as a tool call, so it is opt-in per model (D-067).
   */
  textToolCalls?: boolean
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
  private readonly textToolCalls: boolean

  constructor(config: OllamaConfig) {
    if (!config.model) throw new LLMError('config', 'ollama: `model` is required in config', NAME)
    this.model = config.model
    this.baseUrl = resolveBaseUrl(config.baseUrl)
    const host = new URL(this.baseUrl).hostname
    this.egress = { host, remote: !/^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/i.test(host) }
    this.timeoutMs = config.timeoutMs ?? 120_000
    this.doFetch = config.fetch ?? fetch
    this.textToolCalls = config.textToolCalls === true
  }

  /** `GET /api/tags` - installed models with the digest Ollama reports for each. Throws on failure; callers treat listing as best-effort. */
  async listInstalledModels(signal?: AbortSignal): Promise<Array<{ name: string; digest?: string }>> {
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
    return models
      .map((m: any) => ({ name: String(m?.name ?? m?.model ?? ''), digest: typeof m?.digest === 'string' ? m.digest.toLowerCase() : undefined }))
      .filter((m: { name: string }) => m.name)
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    return (await this.listInstalledModels(signal)).map((m) => m.name)
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
    if (req.jsonSchema) body['format'] = req.jsonSchema
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
    const nativeCalls = (Array.isArray(msg.tool_calls) ? msg.tool_calls : []).filter((tc: any) => tc?.function?.name)
    // Only when the model did NOT use the tool-call channel, and only for tools actually offered in this request.
    const recovered =
      this.textToolCalls && nativeCalls.length === 0 && req.tools?.length && typeof msg.content === 'string'
        ? recoverTextToolCalls(msg.content, new Set(req.tools.map((t) => t.name)))
        : undefined
    if (recovered) {
      for (const r of recovered) content.push({ type: 'tool_use', id: `call_${randomUUID().slice(0, 8)}`, name: r.name, input: r.input })
    } else {
      if (typeof msg.content === 'string' && msg.content.length) content.push({ type: 'text', text: msg.content })
      for (const tc of nativeCalls) {
        const fn = tc.function
        content.push({ type: 'tool_use', id: `call_${randomUUID().slice(0, 8)}`, name: fn.name, input: parseArgs(fn.arguments) })
      }
    }
    const toolCalls = content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : []))
    return {
      model: String(json.model ?? model),
      text: content.map((b) => (b.type === 'text' ? b.text : '')).join(''),
      content,
      toolCalls,
      stopReason: mapStop(json.done_reason, toolCalls.length > 0),
      usage: { inputTokens: json.prompt_eval_count ?? 0, outputTokens: json.eval_count ?? 0 },
      ...(recovered ? { recoveredToolCalls: recovered.length } : {}),
    }
  }
}

const MAX_RECOVERED_CALLS = 8
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Split text that is ONLY a run of top-level JSON objects (one per line as JSON Lines, or back to back) into the object texts. Brace counting
 * respects strings and escapes, so braces inside arguments (code!) do not confuse it. Anything between objects other than whitespace, or an
 * unbalanced object, gives undefined (all-or-nothing, D-088: qwen2.5-coder:7b wrote its read_file and edit_file calls as two lines of JSON).
 */
function splitJsonObjects(t: string): string[] | undefined {
  const out: string[] = []
  let i = 0
  while (i < t.length) {
    while (i < t.length && /\s/.test(t[i]!)) i++
    if (i >= t.length) break
    if (t[i] !== '{') return undefined
    let depth = 0
    let inStr = false
    let esc = false
    let j = i
    for (; j < t.length; j++) {
      const c = t[j]!
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') inStr = true
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) break
    }
    if (depth !== 0 || j >= t.length) return undefined
    out.push(t.slice(i, j + 1))
    if (out.length > MAX_RECOVERED_CALLS) return undefined
    i = j + 1
  }
  return out.length ? out : undefined
}

/**
 * Strict recovery of tool calls written as text (see `OllamaConfig.textToolCalls`). ALL-OR-NOTHING: the whole reply
 * must be one or more calls and nothing else (no prose before or after), each naming a tool in `toolNames`, with
 * `arguments` (or `parameters`) an object or a JSON string of one (absent means no arguments). Returns undefined when
 * the reply is anything other than that, so ordinary answers are never touched.
 */
export function recoverTextToolCalls(text: string, toolNames: ReadonlySet<string>): { name: string; input: Record<string, unknown> }[] | undefined {
  const t = text.trim()
  let payloads: string[]
  const tagRe = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g
  const tagged = [...t.matchAll(tagRe)]
  if (tagged.length > 0) {
    if (t.replace(tagRe, '').trim() !== '') return undefined // prose around the tags
    payloads = tagged.map((m) => m[1]!)
  } else if (t.startsWith('```')) {
    const m = /^```(?:json)?[ \t]*\n?([\s\S]*?)\n?```$/.exec(t)
    if (!m) return undefined
    payloads = [m[1]!]
  } else if (t.startsWith('{')) {
    const objs = splitJsonObjects(t)
    if (!objs) return undefined
    payloads = objs
  } else return undefined
  if (payloads.length === 0 || payloads.length > MAX_RECOVERED_CALLS) return undefined

  const out: { name: string; input: Record<string, unknown> }[] = []
  for (const p of payloads) {
    let obj: unknown
    try {
      obj = JSON.parse(p)
    } catch {
      return undefined
    }
    if (!isPlainObject(obj) || typeof obj['name'] !== 'string' || !toolNames.has(obj['name'])) return undefined
    let args: unknown = 'arguments' in obj ? obj['arguments'] : 'parameters' in obj ? obj['parameters'] : {}
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args)
      } catch {
        return undefined
      }
    }
    if (!isPlainObject(args)) return undefined
    out.push({ name: obj['name'], input: args })
  }
  return out
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
