import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { SessionLog } from '../src/bundles/session-log/index.js'
import {
  LLMError,
  LLMService,
  OpenAICompatibleProvider,
  RateLimiter,
  type CompletionRequest,
  type ModelAdapterConfig,
} from '../src/bundles/model-adapter/index.js'

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
const okBody = (over: object = {}) => ({
  model: 'vendor/model:free',
  choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 7, completion_tokens: 3 },
  ...over,
})

async function boot(openaiCompatible: object, extra: Partial<ModelAdapterConfig> = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(LLMService, { openaiCompatible, ...extra } as ModelAdapterConfig)
  return ctx
}
const cfg = (f: typeof fetch, over: object = {}) => ({
  name: 'openrouter', model: 'vendor/model:free', baseUrl: BASE, apiKey: KEY, fetch: f, ...over,
})
const req = (over: Partial<CompletionRequest> = {}): CompletionRequest => ({
  sessionId: 's',
  messages: [{ role: 'user', content: 'ping' }],
  ...over,
})
const events = async (ctx: Context) => ctx.log.read('s')

describe('openai-compatible provider: wire format', () => {
  it('sends the right request and maps text + usage', async () => {
    const { f, calls } = fakeFetch(() => json(200, okBody()))
    const ctx = await boot(cfg(f), { egress: { consent: true } })
    const res = await ctx.llm.complete(req({ system: 'be brief', maxTokens: 50, temperature: 0 }))
    expect(res).toMatchObject({ provider: 'openrouter', text: 'hello', stopReason: 'end_turn', usage: { inputTokens: 7, outputTokens: 3 } })
    const c = calls[0]!
    expect(c.url).toBe(`${BASE}/chat/completions`)
    expect((c.init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(c.init.body as string)).toEqual({
      model: 'vendor/model:free', stream: false, max_tokens: 50, temperature: 0,
      messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'ping' }],
    })
  })

  it('maps tools out and tool_calls back in', async () => {
    const { f, calls } = fakeFetch(() =>
      json(200, okBody({
        choices: [{
          finish_reason: 'tool_calls',
          message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"a.ts"}' } }] },
        }],
      })),
    )
    const ctx = await boot(cfg(f), { egress: { consent: true } })
    const res = await ctx.llm.complete(req({ tools: [{ name: 'read', description: 'read a file', inputSchema: { type: 'object' } }] }))
    expect(res.stopReason).toBe('tool_use')
    expect(res.toolCalls).toEqual([{ id: 'call_1', name: 'read', input: { path: 'a.ts' } }])
    expect(JSON.parse(calls[0]!.init.body as string).tools).toEqual([
      { type: 'function', function: { name: 'read', description: 'read a file', parameters: { type: 'object' } } },
    ])
  })

  it('keeps malformed tool arguments instead of throwing', async () => {
    const { f } = fakeFetch(() =>
      json(200, okBody({ choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [{ id: 'c', function: { name: 'x', arguments: '{oops' } }] } }] })),
    )
    const ctx = await boot(cfg(f), { egress: { consent: true } })
    const res = await ctx.llm.complete(req())
    expect(res.toolCalls[0]).toMatchObject({ name: 'x', input: { _raw: '{oops' } })
  })

  it('maps tool history: assistant tool_use -> tool_calls, tool_result -> role:tool', async () => {
    const { f, calls } = fakeFetch(() => json(200, okBody()))
    const ctx = await boot(cfg(f), { egress: { consent: true } })
    await ctx.llm.complete(req({
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'read', input: { p: 1 } }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c1', content: 'file text' }] },
      ],
    }))
    expect(JSON.parse(calls[0]!.init.body as string).messages).toEqual([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read', arguments: '{"p":1}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'file text' },
    ])
  })

  it('maps finish_reason length to max_tokens', async () => {
    const { f } = fakeFetch(() => json(200, okBody({ choices: [{ message: { content: 'cut' }, finish_reason: 'length' }] })))
    const ctx = await boot(cfg(f), { egress: { consent: true } })
    expect((await ctx.llm.complete(req())).stopReason).toBe('max_tokens')
  })

  it('needs no key for a keyless local server, and sends no auth header', async () => {
    const { f, calls } = fakeFetch(() => json(200, okBody()))
    const ctx = await boot(cfg(f, { apiKey: undefined, baseUrl: 'http://127.0.0.1:8080/v1' }))
    await ctx.llm.complete(req())
    expect((calls[0]!.init.headers as Record<string, string>)['authorization']).toBeUndefined()
  })
})

describe('openai-compatible provider: config', () => {
  it('requires model and a valid baseUrl', () => {
    expect(() => new OpenAICompatibleProvider({ model: '', baseUrl: BASE })).toThrow(LLMError)
    expect(() => new OpenAICompatibleProvider({ model: 'm', baseUrl: '' })).toThrow(LLMError)
    expect(() => new OpenAICompatibleProvider({ model: 'm', baseUrl: 'not a url' })).toThrow(/valid URL/)
  })

  it('fails clearly when apiKeyEnv points at an unset variable', () => {
    delete process.env['HARNESS_TEST_KEY_UNSET']
    expect(() => new OpenAICompatibleProvider({ model: 'm', baseUrl: BASE, apiKeyEnv: 'HARNESS_TEST_KEY_UNSET' })).toThrow(/HARNESS_TEST_KEY_UNSET is not set/)
  })

  it('reads the key from the named environment variable', async () => {
    process.env['HARNESS_TEST_KEY'] = 'env-key-abc123456'
    try {
      const { f, calls } = fakeFetch(() => json(200, okBody()))
      const p = new OpenAICompatibleProvider({ model: 'm', baseUrl: BASE, apiKeyEnv: 'HARNESS_TEST_KEY', fetch: f })
      await p.complete({ messages: [{ role: 'user', content: 'x' }] })
      expect((calls[0]!.init.headers as Record<string, string>)['authorization']).toBe('Bearer env-key-abc123456')
    } finally {
      delete process.env['HARNESS_TEST_KEY']
    }
  })
})

describe('openai-compatible provider: error classification', () => {
  const failing = async (status: number, body: unknown, headers: Record<string, string> = {}) => {
    const { f } = fakeFetch(() => json(status, body, headers))
    const ctx = await boot(cfg(f), { egress: { consent: true } })
    const err = await ctx.llm.complete(req()).catch((e) => e)
    return { err, ctx }
  }

  it('401 -> auth, not retryable', async () => {
    const { err } = await failing(401, { error: { message: 'bad key' } })
    expect(err).toMatchObject({ kind: 'auth', status: 401 })
    expect(err.retryable).toBe(false)
  })

  it('402 -> payment, even though free models are involved', async () => {
    const { err } = await failing(402, { error: { message: 'insufficient credits' } })
    expect(err).toMatchObject({ kind: 'payment', status: 402 })
    expect(err.retryable).toBe(false)
  })

  it('429 that mentions a daily limit -> quota, not retryable', async () => {
    const { err } = await failing(429, { error: { message: 'Rate limit exceeded: free-models-per-day' } })
    expect(err).toMatchObject({ kind: 'quota', status: 429 })
    expect(err.retryable).toBe(false)
  })

  it('other 429 -> rate_limit, retryable, with Retry-After honored', async () => {
    const { err } = await failing(429, { error: { message: 'upstream provider is saturated' } }, { 'retry-after': '12' })
    expect(err).toMatchObject({ kind: 'rate_limit', status: 429, retryAfterMs: 12_000 })
    expect(err.retryable).toBe(true)
  })

  it('429 without Retry-After has no retryAfterMs', async () => {
    const { err } = await failing(429, { error: { message: 'busy' } })
    expect(err.kind).toBe('rate_limit')
    expect(err.retryAfterMs).toBeUndefined()
  })

  it('5xx -> server, retryable; 400 -> invalid_request', async () => {
    expect((await failing(503, { error: { message: 'down' } })).err).toMatchObject({ kind: 'server', retryable: true })
    expect((await failing(400, { error: { message: 'bad' } })).err).toMatchObject({ kind: 'invalid_request' })
  })

  it('HTTP 200 with an error body and no choices is still an error', async () => {
    const { err } = await failing(200, { error: { code: 429, message: 'limit per day reached' } })
    expect(err).toMatchObject({ kind: 'quota', status: 429 })
  })

  it('malformed success body -> server error', async () => {
    const { err } = await failing(200, { nothing: true })
    expect(err).toMatchObject({ kind: 'server' })
  })

  it('network failure and timeout are distinct, retryable errors', async () => {
    const down = (async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) }) as typeof fetch
    let ctx = await boot(cfg(down), { egress: { consent: true } })
    expect(await ctx.llm.complete(req()).catch((e) => e)).toMatchObject({ kind: 'network', retryable: true })

    const hang = ((_u: any, init: any) => new Promise((_r, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')))
    })) as typeof fetch
    ctx = await boot(cfg(hang, { timeoutMs: 20 }), { egress: { consent: true } })
    expect(await ctx.llm.complete(req()).catch((e) => e)).toMatchObject({ kind: 'timeout', retryable: true })
  })

  it('errors are logged as model.error with their kind', async () => {
    const { ctx } = await failing(429, { error: { message: 'daily limit' } })
    const last = (await events(ctx)).at(-1)!
    expect(last.type).toBe('model.error')
    expect(last.data).toMatchObject({ kind: 'quota', status: 429 })
  })
})

describe('openai-compatible provider: the API key never leaks', () => {
  it('is absent from the session log, including when a server echoes it back', async () => {
    const { f } = fakeFetch(() => json(401, { error: { message: `Invalid key ${KEY} for this account` } }))
    const ctx = await boot(cfg(f), { egress: { consent: true } })
    const err = await ctx.llm.complete(req()).catch((e) => e)
    expect(err.message).not.toContain(KEY)
    expect(err.message).toContain('[redacted]')
    expect(JSON.stringify(await events(ctx))).not.toContain(KEY)
  })

  it('is absent from the log on a successful call and never appears in the request body', async () => {
    const { f, calls } = fakeFetch(() => json(200, okBody()))
    const ctx = await boot(cfg(f), { egress: { consent: true } })
    await ctx.llm.complete(req())
    expect(JSON.stringify(await events(ctx))).not.toContain(KEY)
    expect(calls[0]!.init.body as string).not.toContain(KEY)
  })
})

describe('egress consent (D-022)', () => {
  it('refuses a remote provider without consent, sends nothing, and logs the refusal', async () => {
    const { f, calls } = fakeFetch(() => json(200, okBody()))
    const ctx = await boot(cfg(f))
    const err = await ctx.llm.complete(req()).catch((e) => e)
    expect(err).toBeInstanceOf(LLMError)
    expect(err).toMatchObject({ kind: 'consent', retryable: false })
    expect(calls.length).toBe(0)
    const log = await events(ctx)
    expect(log.map((e) => e.type)).toEqual(['model.blocked'])
    expect(log[0]!.data).toMatchObject({ provider: 'openrouter', host: 'openrouter.ai', reason: 'no_egress_consent' })
    expect(JSON.stringify(log)).not.toContain('ping')
  })

  it('consent must be exactly true', async () => {
    const { f, calls } = fakeFetch(() => json(200, okBody()))
    const ctx = await boot(cfg(f), { egress: { consent: 'yes' as any } })
    await expect(ctx.llm.complete(req())).rejects.toMatchObject({ kind: 'consent' })
    expect(calls.length).toBe(0)
  })

  it('with consent, model.request records destination host and payload size', async () => {
    const { f } = fakeFetch(() => json(200, okBody()))
    const ctx = await boot(cfg(f), { egress: { consent: true } })
    await ctx.llm.complete(req())
    const first = (await events(ctx))[0]!
    expect(first.type).toBe('model.request')
    const eg = (first.data as any).egress
    expect(eg).toMatchObject({ host: 'openrouter.ai', remote: true })
    expect(eg.bytes).toBeGreaterThan(0)
  })

  it('loopback providers need no consent', async () => {
    const { f, calls } = fakeFetch(() => json(200, okBody()))
    const ctx = await boot(cfg(f, { baseUrl: 'http://localhost:8080/v1' }))
    await ctx.llm.complete(req())
    expect(calls.length).toBe(1)
  })

  it('a LAN host counts as remote', async () => {
    const { f } = fakeFetch(() => json(200, okBody()))
    const ctx = await boot(cfg(f, { baseUrl: 'http://192.168.1.20:8080/v1' }))
    await expect(ctx.llm.complete(req())).rejects.toMatchObject({ kind: 'consent' })
  })

  it('a remote Ollama host (for example a cloud endpoint) is gated the same way', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionLog, { memory: true })
    await ctx.plugin(LLMService, { ollama: { model: 'm', baseUrl: 'https://ollama.example.com' } })
    await expect(ctx.llm.complete(req())).rejects.toMatchObject({ kind: 'consent' })
  })

  it('a failing log write blocks the call: nothing is sent unlogged', async () => {
    const { f, calls } = fakeFetch(() => json(200, okBody()))
    const ctx = await boot(cfg(f), { egress: { consent: true } })
    const orig = ctx.log.append.bind(ctx.log)
    ;(ctx.log as any).append = async () => { throw new Error('disk full') }
    await expect(ctx.llm.complete(req())).rejects.toThrow('disk full')
    expect(calls.length).toBe(0)
    ;(ctx.log as any).append = orig
  })
})

describe('openai-compatible provider with the rate limiter', () => {
  it('routes every call through the shared limiter and counts it', async () => {
    const { f } = fakeFetch(() => json(200, okBody()))
    const limiter = new RateLimiter({ perMinute: 100, perDay: 2, provider: 'openrouter' })
    const ctx = await boot(cfg(f, { limiter }), { egress: { consent: true } })
    await ctx.llm.complete(req())
    await ctx.llm.complete(req())
    expect(limiter.remainingToday()).toBe(0)
    const err = await ctx.llm.complete(req()).catch((e) => e)
    expect(err).toMatchObject({ kind: 'quota', retryable: false })
  })

  it('a quota refusal makes no HTTP call', async () => {
    const { f, calls } = fakeFetch(() => json(200, okBody()))
    const limiter = new RateLimiter({ perMinute: 100, perDay: 1 })
    const ctx = await boot(cfg(f, { limiter }), { egress: { consent: true } })
    await ctx.llm.complete(req())
    await ctx.llm.complete(req()).catch(() => {})
    expect(calls.length).toBe(1)
  })

  it('failed HTTP calls still count against the daily total', async () => {
    const { f } = fakeFetch(() => json(500, { error: { message: 'oops' } }))
    const limiter = new RateLimiter({ perMinute: 100, perDay: 5 })
    const ctx = await boot(cfg(f, { limiter }), { egress: { consent: true } })
    await ctx.llm.complete(req()).catch(() => {})
    expect(limiter.remainingToday()).toBe(4)
  })
})

// Opt-in and deliberately tiny: each run spends one request of a free daily quota (50/day on an unfunded
// OpenRouter account). HARNESS_LIVE_OPENROUTER=1 OPENROUTER_API_KEY=... OPENROUTER_MODEL=<exact model id>
const live = process.env['HARNESS_LIVE_OPENROUTER'] === '1' && !!process.env['OPENROUTER_API_KEY'] && !!process.env['OPENROUTER_MODEL']
describe.skipIf(!live)('live OpenRouter (one request)', () => {
  it('real call returns text, and the key stays out of the log', async () => {
    const limiter = new RateLimiter({ perMinute: 10, perDay: 5, provider: 'openrouter' })
    const ctx = await boot(
      { name: 'openrouter', model: process.env['OPENROUTER_MODEL']!, baseUrl: BASE, apiKeyEnv: 'OPENROUTER_API_KEY', limiter, timeoutMs: 60_000 },
      { egress: { consent: true } },
    )
    const res = await ctx.llm.complete(req({ maxTokens: 64, messages: [{ role: 'user', content: 'Reply with the single word: pong' }] }))
    expect(res.text.trim().length).toBeGreaterThan(0)
    expect(JSON.stringify(await events(ctx))).not.toContain(process.env['OPENROUTER_API_KEY']!)
  }, 90_000)
})
