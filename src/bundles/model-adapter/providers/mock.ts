import type { CompletionResponse, LLMProvider, ProviderRequest } from '../types.js'

type Scripted = Partial<Omit<CompletionResponse, 'provider'>> | Error
type Responder = (req: ProviderRequest) => Scripted

/** Deterministic provider for tests and offline runs. Replays a script, then echoes. */
export class MockProvider implements LLMProvider {
  calls: ProviderRequest[] = []
  constructor(private script: Scripted[] | Responder = []) {}

  async complete(req: ProviderRequest) {
    this.calls.push(structuredClone(req))
    const next = typeof this.script === 'function' ? this.script(req) : this.script.shift()
    if (next instanceof Error) throw next
    const last = req.messages[req.messages.length - 1]
    const echo = typeof last?.content === 'string' ? last.content : ''
    const text = next?.text ?? `mock:${echo}`
    return {
      model: next?.model ?? req.model ?? 'mock',
      text,
      content: next?.content ?? [{ type: 'text' as const, text }],
      toolCalls: next?.toolCalls ?? [],
      stopReason: next?.stopReason ?? (next?.toolCalls?.length ? ('tool_use' as const) : ('end_turn' as const)),
      usage: next?.usage ?? { inputTokens: 0, outputTokens: 0 },
    }
  }
}
