import { describe, expect, it } from 'vitest'
import { LLMError, MockProvider, OllamaProvider, OpenAICompatibleProvider } from '../src/bundles/model-adapter/index.js'
import { testProviderConnection } from '../src/bundles/app-core/provider-connection.js'

const KEY = 'sk-or-v1-SECRETKEY1234567890'
const BASE = 'https://openrouter.ai/api/v1'

type FetchCall = { url: string; init: RequestInit }
function fakeFetch(respond: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = []
  const f = (async (url: any, init: any) => {
    const call = { url: String(url), init }
    calls.push(call)
    return respond(call)
  }) as typeof fetch
  return { f, calls }
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const chatOk = () => ({
  model: 'vendor/model:free',
  choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 5, completion_tokens: 1 },
})

describe('testProviderConnection - local provider (MockProvider)', () => {
  it('succeeds with a latency, the model the provider named, and no models field (MockProvider has no listModels)', async () => {
    const provider = new MockProvider([{ text: 'ok', model: 'mock-model' }])
    const result = await testProviderConnection(provider)
    expect(result.ok).toBe(true)
    expect(result.model).toBe('mock-model')
    expect(typeof result.latencyMs).toBe('number')
    expect(result.latencyMs!).toBeGreaterThanOrEqual(0)
    expect(result.models).toBeUndefined()
    expect(result.error).toBeUndefined()
  })

  it('a local provider needs no acknowledgeRemote', async () => {
    const provider = new MockProvider([{ text: 'ok' }])
    const result = await testProviderConnection(provider, { acknowledgeRemote: false })
    expect(result.ok).toBe(true)
  })

  it('surfaces the provider error kind and message on failure, with latency still present', async () => {
    const provider = new MockProvider([new LLMError('invalid_request', 'model not found', 'mock', 404)])
    const result = await testProviderConnection(provider)
    expect(result.ok).toBe(false)
    expect(result.error).toEqual({ kind: 'invalid_request', message: 'model not found' })
    expect(typeof result.latencyMs).toBe('number')
  })

  it('never throws - a plain (non-LLMError) rejection is reported as kind "unknown"', async () => {
    const provider = new MockProvider([new Error('boom')])
    const result = await testProviderConnection(provider)
    expect(result.ok).toBe(false)
    expect(result.error?.kind).toBe('unknown')
    expect(result.error?.message).toBe('boom')
  })
})

describe('testProviderConnection - remote provider gate', () => {
  it('refuses a remote provider without acknowledgeRemote, and never calls the provider at all', async () => {
    const { f, calls } = fakeFetch(() => json(200, chatOk()))
    const provider = new OpenAICompatibleProvider({ name: 'openrouter', model: 'm', baseUrl: BASE, apiKey: KEY, fetch: f })
    const result = await testProviderConnection(provider)
    expect(result.ok).toBe(false)
    expect(result.error?.kind).toBe('consent')
    expect(calls.length).toBe(0)
  })

  it('proceeds once acknowledgeRemote is true', async () => {
    const { f } = fakeFetch(() => json(200, chatOk()))
    const provider = new OpenAICompatibleProvider({ name: 'openrouter', model: 'm', baseUrl: BASE, apiKey: KEY, fetch: f })
    const result = await testProviderConnection(provider, { acknowledgeRemote: true })
    expect(result.ok).toBe(true)
    expect(result.model).toBe('vendor/model:free')
  })

  it('the API key never appears in a failed result, even when the server echoes it back', async () => {
    const { f } = fakeFetch(() => json(401, { error: { message: `bad key: ${KEY}` } }))
    const provider = new OpenAICompatibleProvider({ name: 'openrouter', model: 'm', baseUrl: BASE, apiKey: KEY, fetch: f })
    const result = await testProviderConnection(provider, { acknowledgeRemote: true })
    expect(result.ok).toBe(false)
    expect(result.error?.kind).toBe('auth')
    expect(result.error?.message).not.toContain(KEY)
  })
})

describe('testProviderConnection - model listing (best-effort)', () => {
  it('lists models on success and still runs the probe call', async () => {
    const { f, calls } = fakeFetch((call) =>
      call.url.endsWith('/models') ? json(200, { data: [{ id: 'a' }, { id: 'b' }] }) : json(200, chatOk()),
    )
    const provider = new OpenAICompatibleProvider({ name: 'openrouter', model: 'm', baseUrl: BASE, apiKey: KEY, fetch: f })
    const result = await testProviderConnection(provider, { acknowledgeRemote: true })
    expect(result.models).toEqual({ ok: true, names: ['a', 'b'] })
    expect(result.ok).toBe(true)
    expect(calls.some((c) => c.url.endsWith('/models'))).toBe(true)
    expect(calls.some((c) => c.url.endsWith('/chat/completions'))).toBe(true)
  })

  it('a listing failure does not fail the overall test - the probe call still runs and can still succeed', async () => {
    const { f } = fakeFetch((call) => (call.url.endsWith('/models') ? json(500, {}) : json(200, chatOk())))
    const provider = new OpenAICompatibleProvider({ name: 'openrouter', model: 'm', baseUrl: BASE, apiKey: KEY, fetch: f })
    const result = await testProviderConnection(provider, { acknowledgeRemote: true })
    expect(result.models?.ok).toBe(false)
    expect(result.ok).toBe(true)
  })

  it('omits `models` entirely for a provider that has no listModels method', async () => {
    const provider = new MockProvider([{ text: 'ok' }])
    expect('listModels' in provider).toBe(false)
    const result = await testProviderConnection(provider)
    expect(result.models).toBeUndefined()
  })
})

describe('testProviderConnection - ollama', () => {
  it('lists installed tags and completes the probe', async () => {
    const { f } = fakeFetch((call) =>
      call.url.endsWith('/api/tags')
        ? json(200, { models: [{ name: 'llama3.2:3b' }, { name: 'qwen2.5-coder:3b' }] })
        : json(200, { model: 'llama3.2:3b', message: { role: 'assistant', content: 'ok' }, done_reason: 'stop', prompt_eval_count: 5, eval_count: 1 }),
    )
    const provider = new OllamaProvider({ model: 'llama3.2:3b', baseUrl: 'http://localhost:11434', fetch: f })
    // loopback: no acknowledgeRemote needed
    const result = await testProviderConnection(provider)
    expect(result.ok).toBe(true)
    expect(result.models).toEqual({ ok: true, names: ['llama3.2:3b', 'qwen2.5-coder:3b'] })
  })

  it('a clear, classified error when the model is not installed (HTTP 404)', async () => {
    const { f } = fakeFetch((call) => (call.url.endsWith('/api/tags') ? json(200, { models: [] }) : json(404, { error: 'model not found' })))
    const provider = new OllamaProvider({ model: 'missing:1b', baseUrl: 'http://localhost:11434', fetch: f })
    const result = await testProviderConnection(provider)
    expect(result.ok).toBe(false)
    expect(result.error?.kind).toBe('invalid_request')
    expect(result.error?.message).toContain('missing:1b')
  })

  it('a clear, classified error when Ollama is not reachable at all', async () => {
    const f = (async () => {
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    }) as unknown as typeof fetch
    const provider = new OllamaProvider({ model: 'llama3.2:3b', baseUrl: 'http://localhost:11434', fetch: f })
    const result = await testProviderConnection(provider)
    expect(result.ok).toBe(false)
    expect(result.error?.kind).toBe('network')
    expect(result.models?.ok).toBe(false)
  })
})

describe('testProviderConnection - timeout', () => {
  it('reports kind "timeout" when the provider never responds within timeoutMs', async () => {
    // Mirrors what real fetch does: never resolve on its own, but reject once the signal aborts.
    const never = ((_url: any, init: any) =>
      new Promise<Response>((_resolve, reject) => {
        const sig: AbortSignal | undefined = init?.signal
        sig?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as unknown as typeof fetch
    const provider = new OpenAICompatibleProvider({ name: 'openrouter', model: 'm', baseUrl: BASE, apiKey: KEY, fetch: never, timeoutMs: 60_000 })
    const result = await testProviderConnection(provider, { acknowledgeRemote: true, timeoutMs: 30 })
    expect(result.ok).toBe(false)
    expect(result.error?.kind).toBe('timeout')
  })
})
