import { Context } from 'cordis'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { LLMError, LLMService, MockProvider, resolveBaseUrl, type CompletionRequest } from '../src/bundles/model-adapter/index.js'

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
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const okBody = (over: object = {}) => ({
  model: 'test-model',
  message: { role: 'assistant', content: 'hello' },
  done: true,
  done_reason: 'stop',
  prompt_eval_count: 5,
  eval_count: 2,
  ...over,
})

// Cordis loads plugins asynchronously: always await the fibers before using ctx.log / ctx.llm.
async function boot(ollama?: object) {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  // 1B.1 (D-029): LLMService requires ctx.egress unconditionally. Every test here is
  // loopback-only (localhost/127.0.0.1), so the gate never actually triggers - no consent
  // or allowlist is granted, matching "no remote call is possible by default".
  await ctx.plugin(EgressPolicy, { projectId: 'test' })
  await ctx.plugin(LLMService, ollama ? { ollama } : ({} as any))
  return ctx
}
const req = (over: Partial<CompletionRequest> = {}): CompletionRequest => ({
  sessionId: 's',
  messages: [{ role: 'user', content: 'ping' }],
  ...over,
})
const types = async (ctx: Context) => (await ctx.log.read('s')).map((e) => e.type)

describe('ollama provider (mocked HTTP)', () => {
  it('sends the right request and maps text + usage', async () => {
    const { f, calls } = fakeFetch(() => json(200, okBody()))
    const ctx = await boot({ model: 'test-model', fetch: f })
    const res = await ctx.llm.complete(req({ system: 'be brief', maxTokens: 50, temperature: 0 }))
    expect(res).toMatchObject({ provider: 'ollama', text: 'hello', stopReason: 'end_turn', usage: { inputTokens: 5, outputTokens: 2 } })
    const c = calls[0]!
    expect(c.url).toBe('http://localhost:11434/api/chat')
    expect(JSON.parse(c.init.body as string)).toEqual({
      model: 'test-model', stream: false,
      options: { temperature: 0, num_predict: 50 },
      messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'ping' }],
    })
    // no credentials of any kind are sent
    expect(JSON.stringify(c.init.headers)).not.toMatch(/key|auth|bearer/i)
  })

  it('maps tools, tool_calls in the response, and tool_use/tool_result history', async () => {
    const { f, calls } = fakeFetch(() =>
      json(200, okBody({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a.txt' } } }] } })))
    const ctx = await boot({ model: 'm', fetch: f })
    const res = await ctx.llm.complete(req({
      tools: [{ name: 'read_file', description: 'read', inputSchema: { type: 'object' } }],
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: [{ type: 'text', text: 'listing' }, { type: 'tool_use', id: 'c0', name: 'ls', input: { d: '.' } }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c0', content: 'a.txt' }] },
      ],
    }))
    expect(res.stopReason).toBe('tool_use')
    expect(res.toolCalls).toHaveLength(1)
    expect(res.toolCalls[0]).toMatchObject({ name: 'read_file', input: { path: 'a.txt' } })
    expect(res.toolCalls[0]!.id).toMatch(/^call_/)
    const body = JSON.parse(calls[0]!.init.body as string)
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'read_file', description: 'read', parameters: { type: 'object' } } }])
    expect(body.messages).toEqual([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'listing', tool_calls: [{ function: { name: 'ls', arguments: { d: '.' } } }] },
      { role: 'tool', tool_name: 'ls', content: 'a.txt' },
    ])
  })

  it('tolerates string tool arguments and maps done_reason=length', async () => {
    const { f } = fakeFetch(() =>
      json(200, okBody({ done_reason: 'length', message: { role: 'assistant', content: 'cut', tool_calls: [{ function: { name: 't', arguments: '{"a":1}' } }] } })))
    const ctx = await boot({ model: 'm', fetch: f })
    const res = await ctx.llm.complete(req())
    expect(res.toolCalls[0]!.input).toEqual({ a: 1 })
    const { f: f2 } = fakeFetch(() => json(200, okBody({ done_reason: 'length' })))
    expect((await (await boot({ model: 'm', fetch: f2 })).llm.complete(req())).stopReason).toBe('max_tokens')
  })

  it('requires model; resolves base URL from config, OLLAMA_HOST, or default', async () => {
    expect(() => new LLMService(new Context(), { ollama: {} as any })).toThrow(/model/)
    const saved = process.env['OLLAMA_HOST']
    try {
      delete process.env['OLLAMA_HOST']
      expect(resolveBaseUrl()).toBe('http://localhost:11434')
      expect(resolveBaseUrl('http://box:1234/')).toBe('http://box:1234')
      process.env['OLLAMA_HOST'] = '127.0.0.1:9999'
      expect(resolveBaseUrl()).toBe('http://127.0.0.1:9999')
      expect(resolveBaseUrl('https://remote.example')).toBe('https://remote.example')
    } finally {
      if (saved === undefined) delete process.env['OLLAMA_HOST']
      else process.env['OLLAMA_HOST'] = saved
    }
  })

  it('unknown model (404) -> clear error telling you to pull it', async () => {
    const { f } = fakeFetch(() => json(404, { error: 'model "nope:1b" not found, try pulling it first' }))
    const ctx = await boot({ model: 'nope:1b', fetch: f })
    const err = await ctx.llm.complete(req()).catch((e) => e)
    expect(err).toBeInstanceOf(LLMError)
    expect(err).toMatchObject({ kind: 'invalid_request', status: 404, retryable: false })
    expect(err.message).toContain('ollama pull nope:1b')
    expect(await types(ctx)).toEqual(['model.request', 'model.error'])
  })

  it.each([
    [400, 'invalid_request', false],
    [500, 'server', true],
    [503, 'server', true],
  ])('HTTP %i -> %s', async (status, kind, retryable) => {
    const { f } = fakeFetch(() => json(status, { error: 'boom' }))
    const err = await (await boot({ model: 'm', fetch: f })).llm.complete(req()).catch((e) => e)
    expect(err).toMatchObject({ kind, status, retryable })
    expect(err.message).toContain('boom')
  })

  it('surfaces network failure, timeout, and malformed bodies as typed errors', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    const net = await boot({ model: 'm', fetch: (async () => { throw refused }) as any })
    const e1 = await net.llm.complete(req()).catch((e) => e)
    expect(e1).toMatchObject({ kind: 'network', retryable: true })
    expect(e1.message).toMatch(/ECONNREFUSED.*ollama serve/s)

    const hang = fakeFetch((c) => new Promise((_, rej) => c.init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))))
    const slow = await boot({ model: 'm', fetch: hang.f, timeoutMs: 25 })
    await expect(slow.llm.complete(req())).rejects.toMatchObject({ kind: 'timeout' })

    const bad = await boot({ model: 'm', fetch: fakeFetch(() => json(200, { nope: 1 })).f })
    await expect(bad.llm.complete(req())).rejects.toMatchObject({ kind: 'server' })
  })
})

describe('ollama provider (real HTTP over loopback)', () => {
  const listen = (handler: Parameters<typeof createServer>[1]) =>
    new Promise<{ server: Server; url: string }>((resolve) => {
      const server = createServer(handler)
      server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }))
    })

  it('completes against a real HTTP server, and reports 404 for a missing model', async () => {
    const seen: any[] = []
    const { server, url } = await listen((rq, rs) => {
      let b = ''
      rq.on('data', (c) => (b += c))
      rq.on('end', () => {
        const body = JSON.parse(b)
        seen.push({ path: rq.url, method: rq.method, body })
        rs.setHeader('content-type', 'application/json')
        if (body.model === 'missing') { rs.statusCode = 404; return rs.end(JSON.stringify({ error: 'model "missing" not found, try pulling it first' })) }
        rs.end(JSON.stringify(okBody({ model: body.model, message: { role: 'assistant', content: 'pong' } })))
      })
    })
    try {
      const ctx = await boot({ model: 'llama-x', baseUrl: url })
      const res = await ctx.llm.complete(req())
      expect(res.text).toBe('pong')
      expect(seen[0]).toMatchObject({ path: '/api/chat', method: 'POST', body: { model: 'llama-x', stream: false } })
      await expect(ctx.llm.complete(req({ model: 'missing' }))).rejects.toMatchObject({ kind: 'invalid_request', status: 404 })
    } finally {
      server.close()
    }
  })

  it('nothing listening -> clear "is Ollama running?" error, not a hang or crash', async () => {
    const { server, url } = await listen(() => {})
    await new Promise((r) => server.close(r))
    const ctx = await boot({ model: 'm', baseUrl: url, timeoutMs: 5000 })
    const err = await ctx.llm.complete(req()).catch((e) => e)
    expect(err).toBeInstanceOf(LLMError)
    expect(err.kind).toBe('network')
    expect(err.message).toMatch(/Is Ollama running/)
  })
})

describe('ctx.llm service', () => {
  it('plug-and-play: a mock provider registers from another plugin, same call path, first provider untouched', async () => {
    const { f } = fakeFetch(() => json(200, okBody({ message: { role: 'assistant', content: 'from-ollama' } })))
    const ctx = await boot({ model: 'm', fetch: f })
    const mock = new MockProvider([{ text: 'from-mock' }])
    const fiber = ctx.plugin({
      name: 'mock-provider-bundle',
      inject: ['llm'],
      apply(c: Context) { c.effect(() => c.llm.register('mock', mock)) },
    } as any)
    await fiber

    const ask = (provider: string) => ctx.llm.complete(req({ provider })).then((r) => r.text)
    expect(await ask('ollama')).toBe('from-ollama')
    expect(await ask('mock')).toBe('from-mock')
    expect(ctx.llm.list().sort()).toEqual(['mock', 'ollama'])

    await fiber.dispose()
    expect(ctx.llm.list()).toEqual(['ollama'])
    await expect(ask('mock')).rejects.toMatchObject({ kind: 'config' })
  })

  it('rejects duplicate provider names and missing/unknown providers with clear errors', async () => {
    const ctx = await boot()
    ctx.llm.register('a', new MockProvider())
    expect(() => ctx.llm.register('a', new MockProvider())).toThrow(/already registered/)
    await expect(ctx.llm.complete(req())).rejects.toThrow(/no provider specified/)
    await expect(ctx.llm.complete(req({ provider: 'zzz' }))).rejects.toThrow(/unknown provider "zzz".*a/)
  })

  it('logs model.request BEFORE the provider is called, then model.response', async () => {
    const ctx = await boot()
    let seenBeforeCall: string[] = []
    const mock = new MockProvider([{ text: 'ok' }])
    const orig = mock.complete.bind(mock)
    mock.complete = async (r) => {
      seenBeforeCall = await types(ctx)
      return orig(r)
    }
    ctx.llm.register('m', mock, { default: true })
    await ctx.llm.complete(req({ actor: 'agent-1' }))
    expect(seenBeforeCall).toEqual(['model.request'])
    const log = await ctx.log.read('s')
    expect(log.map((e) => e.type)).toEqual(['model.request', 'model.response'])
    expect(log[0]!.actor).toBe('agent-1')
    expect((log[0]!.data as any).messages).toEqual([{ role: 'user', content: 'ping' }])
    expect((log[1]!.data as any).text).toBe('ok')
  })

  it('fails closed: if the log write fails, the model is never called', async () => {
    const ctx = await boot()
    const mock = new MockProvider()
    ctx.llm.register('m', mock, { default: true })
    ctx.log.append = async () => { throw new Error('disk full') }
    await expect(ctx.llm.complete(req())).rejects.toThrow('disk full')
    expect(mock.calls).toHaveLength(0)
  })

  it('wraps unexpected provider exceptions as LLMError(unknown) and logs them', async () => {
    const ctx = await boot()
    ctx.llm.register('m', { complete: async () => { throw new RangeError('bug') } }, { default: true })
    await expect(ctx.llm.complete(req())).rejects.toMatchObject({ kind: 'unknown', retryable: false })
    expect(await types(ctx)).toEqual(['model.request', 'model.error'])
  })
})

// Opt-in: needs a running Ollama.  HARNESS_LIVE=1 OLLAMA_MODEL=<installed tag> [OLLAMA_HOST=...]
const live = process.env['HARNESS_LIVE'] === '1'
describe.skipIf(!live)('live Ollama', () => {
  it('uninstalled model -> clear "ollama pull" error', async () => {
    const ctx = await boot({ model: 'harness-no-such-model:0b', timeoutMs: 15_000 })
    const err = await ctx.llm.complete(req()).catch((e) => e)
    expect(err).toBeInstanceOf(LLMError)
    expect(err.kind).toBe('invalid_request')
    expect(err.message).toContain('ollama pull')
  })

  it.skipIf(!process.env['OLLAMA_MODEL'])('real call returns non-empty text', async () => {
    const ctx = await boot({ model: process.env['OLLAMA_MODEL']!, timeoutMs: 170_000 })
    const res = await ctx.llm.complete(req({ maxTokens: 64, messages: [{ role: 'user', content: 'Reply with the single word: pong' }] }))
    expect(res.text.trim().length).toBeGreaterThan(0)
    expect(res.usage.outputTokens).toBeGreaterThan(0)
  }, 180_000) // vitest's default 5s would cut off a cold model load; the adapter's own timeout is 120s
})
