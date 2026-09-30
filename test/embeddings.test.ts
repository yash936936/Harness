import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import {
  Embeddings,
  EmbeddingProviderError,
  EmbeddingsConfigError,
  HashingEmbeddingProvider,
  OllamaEmbeddingProvider,
  type EmbedResult,
  type EmbeddingProvider,
  type EmbeddingsConfig,
} from '../src/bundles/embeddings/index.js'

/* ------------------------------------------------------------------ helpers */

async function boot(config: EmbeddingsConfig = {}, provider?: EmbeddingProvider) {
  const ctx = new Context()
  const fiber = await ctx.plugin(Embeddings, config)
  if (provider) ctx.embeddings.register(provider)
  return { ctx, fiber, svc: ctx.embeddings }
}

/** A provider that records what it was asked and answers with `[len, 1, 0]`-style vectors. */
function stub(over: Partial<EmbeddingProvider> & { answer?: (texts: readonly string[]) => number[][] } = {}) {
  const calls: string[][] = []
  const provider: EmbeddingProvider = {
    name: 'stub',
    model: 'stub-1',
    egress: { host: 'localhost', remote: false },
    embed: async (texts) => {
      calls.push([...texts])
      return over.answer ? over.answer(texts) : texts.map((t) => [t.length, 1, 0])
    },
    ...over,
  }
  return { provider, calls }
}

const ok = (r: EmbedResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.kind}: ${r.error.detail}`)
  return r
}
const kind = (r: EmbedResult) => (r.ok ? 'ok' : r.error.kind)
const cosine = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * (b[i] as number), 0) / (Math.hypot(...a) * Math.hypot(...b))

/* ------------------------------------------------------------------ service */

describe('Embeddings service', () => {
  it('returns one vector per text, in input order, with the provider model and dimension', async () => {
    const { provider } = stub()
    const { svc } = await boot({ normalize: false }, provider)
    const r = ok(await svc.embed(['a', 'bbb', 'cc']))
    expect(r.vectors.map((v) => Array.from(v))).toEqual([[1, 1, 0], [3, 1, 0], [2, 1, 0]])
    expect(r.model).toBe('stub-1')
    expect(r.dimensions).toBe(3)
  })

  it('embeds identical texts once and still returns every position', async () => {
    const { provider, calls } = stub()
    const { svc } = await boot({ normalize: false }, provider)
    const r = ok(await svc.embed(['x', 'y', 'x', 'x', 'y']))
    expect(calls).toEqual([['x', 'y']])
    expect(r.unique).toBe(2)
    expect(Array.from(r.vectors[0] as Float32Array)).toEqual(Array.from(r.vectors[2] as Float32Array))
    expect(Array.from(r.vectors[1] as Float32Array)).toEqual(Array.from(r.vectors[4] as Float32Array))
    expect(r.vectors).toHaveLength(5)
  })

  it('batches by count: 100 texts at maxBatchSize 32 is 4 calls, not 100', async () => {
    const { provider, calls } = stub()
    const { svc } = await boot({ maxBatchSize: 32 }, provider)
    const r = ok(await svc.embed(Array.from({ length: 100 }, (_, i) => `text ${i}`)))
    expect(r.requests).toBe(4)
    expect(calls.map((c) => c.length)).toEqual([32, 32, 32, 4])
    expect(r.vectors).toHaveLength(100)
  })

  it('batches by characters, and an oversized text still goes out alone', async () => {
    const { provider, calls } = stub()
    const { svc } = await boot({ maxBatchChars: 10, maxBatchSize: 50, maxInputChars: 100 }, provider)
    ok(await svc.embed(['aaaa', 'bbbb', 'cccc', 'd'.repeat(30), 'ee']))
    expect(calls).toEqual([['aaaa', 'bbbb'], ['cccc'], ['d'.repeat(30)], ['ee']])
  })

  it('cuts over-long texts, counts them, and never splits a surrogate pair', async () => {
    const { provider, calls } = stub()
    const { svc } = await boot({ maxInputChars: 4 }, provider)
    const r = ok(await svc.embed(['abcdefghij', 'abc😀d', 'abcd']))
    expect(r.truncated).toBe(2) // 'abcd' fits exactly and is not counted
    // a plain slice(0, 4) of 'abc😀d' would end in half of the emoji
    expect(calls[0]).toEqual(['abcd', 'abc'])
  })

  it('applies the prefix for the requested kind, documents by default', async () => {
    const { provider, calls } = stub()
    const { svc } = await boot({ prefixes: { document: 'search_document: ', query: 'search_query: ' } }, provider)
    ok(await svc.embed(['hello']))
    ok(await svc.embed(['hello'], { kind: 'query' }))
    expect(calls).toEqual([['search_document: hello'], ['search_query: hello']])
  })

  it('normalises to unit length by default, and leaves vectors alone when told not to', async () => {
    const { provider } = stub({ answer: () => [[3, 4, 0]] })
    const a = ok(await (await boot({}, provider)).svc.embed(['x']))
    expect(Array.from(a.vectors[0] as Float32Array)).toEqual([expect.closeTo(0.6, 6), expect.closeTo(0.8, 6), 0])
    const { provider: p2 } = stub({ answer: () => [[3, 4, 0]] })
    const b = ok(await (await boot({ normalize: false }, p2)).svc.embed(['x']))
    expect(Array.from(b.vectors[0] as Float32Array)).toEqual([3, 4, 0])
  })

  it('an empty list is ok with no provider call; empty or blank text is an input error naming the index', async () => {
    const { provider, calls } = stub()
    const { svc } = await boot({}, provider)
    expect(ok(await svc.embed([])).vectors).toEqual([])
    const r = await svc.embed(['fine', '   ', 'also fine'])
    expect(kind(r)).toBe('input')
    expect(!r.ok && r.error.detail).toContain('index 1')
    expect(kind(await svc.embed(['ok', 5 as unknown as string]))).toBe('input')
    expect(calls).toEqual([])
  })

  it('reports config when no provider is registered', async () => {
    const { svc } = await boot()
    expect(kind(await svc.embed(['x']))).toBe('config')
    expect(svc.info()).toBeUndefined()
  })

  it('refuses a provider that would send text off this machine, without calling it', async () => {
    const { provider, calls } = stub({ egress: { host: 'embeddings.example.com', remote: true } })
    const { svc } = await boot({}, provider)
    const r = await svc.embed(['secret source code'])
    expect(kind(r)).toBe('consent')
    expect(!r.ok && r.error.detail).toContain('embeddings.example.com')
    expect(calls).toEqual([])
  })

  it('a second provider is rejected; disposing the plugin unregisters the first', async () => {
    const { provider } = stub()
    const { svc, fiber } = await boot({}, provider)
    expect(() => svc.register(stub().provider)).toThrow(EmbeddingsConfigError)
    expect(svc.info()?.provider).toBe('stub')
    await fiber.dispose()
  })

  it('the disposer returned by register frees the slot for another provider', async () => {
    const { svc } = await boot()
    const off = svc.register(stub().provider)
    off()
    expect(svc.info()).toBeUndefined()
    expect(() => svc.register(stub().provider)).not.toThrow()
  })

  it('rejects bad config', async () => {
    await expect(boot({ maxBatchSize: 0 })).rejects.toBeInstanceOf(EmbeddingsConfigError)
    await expect(boot({ maxInputChars: 1.5 })).rejects.toBeInstanceOf(EmbeddingsConfigError)
    await expect(boot({ ollama: { model: '' } })).rejects.toBeInstanceOf(EmbeddingsConfigError)
  })

  describe('failures are values', () => {
    it('provider errors keep their kind; anything else becomes unknown', async () => {
      const a = await boot({}, stub({ embed: async () => { throw new EmbeddingProviderError('timeout', 'slow') } }).provider)
      expect(kind(await a.svc.embed(['x']))).toBe('timeout')
      const b = await boot({}, stub({ embed: async () => { throw new Error('boom') } }).provider)
      const r = await b.svc.embed(['x'])
      expect(kind(r)).toBe('unknown')
      expect(!r.ok && r.error.detail).toContain('boom')
    })

    it('wrong vector count, non-finite and empty vectors, ragged lengths are malformed', async () => {
      const cases: Array<(t: readonly string[]) => number[][]> = [
        () => [[1, 2]], // one back for two sent
        (t) => t.map(() => [1, NaN]),
        (t) => t.map(() => []),
        () => [[1, 2], [1, 2, 3]],
      ]
      for (const answer of cases) {
        const { svc } = await boot({}, stub({ answer }).provider)
        expect(kind(await svc.embed(['a', 'b']))).toBe('malformed')
      }
    })

    it('a different dimension on a later call is dimension_mismatch, and info() carries the fingerprint', async () => {
      let dims = 4
      const { svc } = await boot({}, stub({ answer: (t) => t.map(() => new Array<number>(dims).fill(1)) }).provider)
      expect(svc.info()).toEqual({ provider: 'stub', model: 'stub-1' })
      ok(await svc.embed(['a']))
      expect(svc.info()).toEqual({ provider: 'stub', model: 'stub-1', dimensions: 4, fingerprint: 'stub:stub-1:4' })
      dims = 5
      expect(kind(await svc.embed(['b']))).toBe('dimension_mismatch')
      dims = 4
      expect(kind(await svc.embed(['c']))).toBe('ok')
    })

    it('an already-aborted signal never reaches the provider', async () => {
      const { provider, calls } = stub()
      const { svc } = await boot({}, provider)
      const ac = new AbortController()
      ac.abort()
      expect(kind(await svc.embed(['x'], { signal: ac.signal }))).toBe('aborted')
      expect(calls).toEqual([])
    })

    it('aborting mid-flight is reported as aborted, not as the provider error', async () => {
      const ac = new AbortController()
      const { svc } = await boot({}, stub({ embed: async () => { ac.abort(); throw new Error('AbortError') } }).provider)
      expect(kind(await svc.embed(['x'], { signal: ac.signal }))).toBe('aborted')
    })

    it('a failure in a later batch fails the whole call (no partial vectors)', async () => {
      let n = 0
      const { svc } = await boot({ maxBatchSize: 1 }, stub({ embed: async (t) => { if (++n === 2) throw new EmbeddingProviderError('server', 'x'); return t.map(() => [1, 0]) } }).provider)
      expect(kind(await svc.embed(['a', 'b', 'c']))).toBe('server')
    })
  })
})

/* ------------------------------------------------------------- hashing provider */

describe('HashingEmbeddingProvider', () => {
  const setup = () => boot({}, new HashingEmbeddingProvider({ dimensions: 128 }))

  it('is deterministic: the same text gives identical vectors, every time', async () => {
    const { svc } = await setup()
    const a = ok(await svc.embed(['function parseConfig(path)']))
    const b = ok(await svc.embed(['function parseConfig(path)']))
    expect(Array.from(a.vectors[0] as Float32Array)).toEqual(Array.from(b.vectors[0] as Float32Array))
    expect(a.dimensions).toBe(128)
  })

  it('shared identifiers score higher than unrelated text, splitting camelCase and snake_case', async () => {
    const { svc } = await setup()
    const r = ok(await svc.embed(['parseConfigFile', 'parse_config_file helper', 'render the banana bread recipe']))
    const [a, b, c] = r.vectors as [Float32Array, Float32Array, Float32Array]
    expect(cosine(a, b)).toBeGreaterThan(0.5)
    expect(cosine(a, c)).toBeLessThan(0.2)
  })

  it('punctuation-only text still gets a usable (non-zero) vector', async () => {
    const { svc } = await setup()
    const r = ok(await svc.embed(['!!!', '???']))
    expect(r.vectors.every((v) => v.some((x) => x !== 0))).toBe(true)
    expect(Array.from(r.vectors[0] as Float32Array)).not.toEqual(Array.from(r.vectors[1] as Float32Array))
  })

  it('rejects silly dimensions', () => {
    expect(() => new HashingEmbeddingProvider({ dimensions: 2 })).toThrow(RangeError)
  })
})

/* ------------------------------------------------- Ollama provider, real HTTP */

interface Seen { method?: string; url?: string; headers: IncomingHttpHeaders; body: string }

async function serve(handler: (seen: Seen, res: ServerResponse) => void) {
  const requests: Seen[] = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const seen = { method: req.method, url: req.url, headers: req.headers, body }
      requests.push(seen)
      handler(seen, res)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()) }),
  }
}

/** Behaves like Ollama's /api/embed: one vector per input, `[length, index, 1]`. */
const okHandler = (seen: Seen, res: ServerResponse) => {
  const { input } = JSON.parse(seen.body) as { input: string[] }
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ model: 'm', embeddings: input.map((t, i) => [t.length, i, 1]) }))
}

describe('OllamaEmbeddingProvider over real HTTP', () => {
  it('POSTs /api/embed with the model and the whole batch as `input`, and parses `embeddings`', async () => {
    const s = await serve(okHandler)
    try {
      const { svc } = await boot({ ollama: { model: 'nomic-embed-text', baseUrl: s.url }, normalize: false })
      const r = ok(await svc.embed(['alpha', 'be']))
      expect(r.vectors.map((v) => Array.from(v))).toEqual([[5, 0, 1], [2, 1, 1]])
      expect(s.requests).toHaveLength(1)
      const req = s.requests[0]!
      expect(req.method).toBe('POST')
      expect(req.url).toBe('/api/embed')
      expect(req.headers['content-type']).toBe('application/json')
      expect(JSON.parse(req.body)).toEqual({ model: 'nomic-embed-text', input: ['alpha', 'be'], truncate: true })
    } finally { await s.close() }
  })

  it('sends keep_alive only when configured', async () => {
    const s = await serve(okHandler)
    try {
      await ok(await (await boot({ ollama: { model: 'm', baseUrl: s.url, keepAlive: '10m' } })).svc.embed(['x']))
      expect(JSON.parse(s.requests[0]!.body).keep_alive).toBe('10m')
    } finally { await s.close() }
  })

  it('performance criterion: 40 texts cost 2 HTTP calls at batch size 20, not 40', async () => {
    const s = await serve(okHandler)
    try {
      const { svc } = await boot({ ollama: { model: 'm', baseUrl: s.url }, maxBatchSize: 20 })
      const r = ok(await svc.embed(Array.from({ length: 40 }, (_, i) => `text number ${i}`)))
      expect(r.vectors).toHaveLength(40)
      expect(s.requests).toHaveLength(2)
      expect(s.requests.map((q) => JSON.parse(q.body).input.length)).toEqual([20, 20])
    } finally { await s.close() }
  })

  it('accepts a bare host:port and a trailing slash', async () => {
    const s = await serve(okHandler)
    try {
      ok(await (await boot({ ollama: { model: 'm', baseUrl: `127.0.0.1:${s.port}/` } })).svc.embed(['x']))
      expect(s.requests[0]!.url).toBe('/api/embed')
    } finally { await s.close() }
  })

  it('404 is model_missing and tells you how to install it', async () => {
    const s = await serve((_, res) => { res.statusCode = 404; res.end(JSON.stringify({ error: 'model "nope" not found, try pulling it first' })) })
    try {
      const r = await (await boot({ ollama: { model: 'nope', baseUrl: s.url } })).svc.embed(['x'])
      expect(kind(r)).toBe('model_missing')
      expect(!r.ok && r.error.detail).toContain('ollama pull nope')
    } finally { await s.close() }
  })

  it('other HTTP errors are server errors carrying the message', async () => {
    const s = await serve((_, res) => { res.statusCode = 500; res.end(JSON.stringify({ error: 'out of memory' })) })
    try {
      const r = await (await boot({ ollama: { model: 'm', baseUrl: s.url } })).svc.embed(['x'])
      expect(kind(r)).toBe('server')
      expect(!r.ok && r.error.detail).toContain('out of memory')
    } finally { await s.close() }
  })

  it('a 200 with the wrong shape, or not JSON, is malformed', async () => {
    for (const body of ['{"embeddings":[["a"]]}', '{"embeddings":"x"}', '{"nope":1}', 'not json at all']) {
      const s = await serve((_, res) => { res.end(body) })
      try {
        expect(kind(await (await boot({ ollama: { model: 'm', baseUrl: s.url } })).svc.embed(['x']))).toBe('malformed')
      } finally { await s.close() }
    }
  })

  it('a server that never answers is a timeout', async () => {
    const s = await serve(() => { /* hang */ })
    try {
      const r = await (await boot({ ollama: { model: 'm', baseUrl: s.url, timeoutMs: 60 } })).svc.embed(['x'])
      expect(kind(r)).toBe('timeout')
    } finally { await s.close() }
  })

  it('nothing listening is a network error that says to start Ollama', async () => {
    const s = await serve(okHandler)
    const url = s.url
    await s.close()
    const r = await (await boot({ ollama: { model: 'm', baseUrl: url } })).svc.embed(['x'])
    expect(kind(r)).toBe('network')
    expect(!r.ok && r.error.detail).toContain('ollama serve')
  })

  it('a caller abort during the request is reported as aborted', async () => {
    const s = await serve(() => { /* hang */ })
    try {
      const { svc } = await boot({ ollama: { model: 'm', baseUrl: s.url } })
      const ac = new AbortController()
      const p = svc.embed(['x'], { signal: ac.signal })
      setTimeout(() => ac.abort(), 30)
      expect(kind(await p)).toBe('aborted')
    } finally { await s.close() }
  })

  it('used directly (without the service) an abort is an EmbeddingProviderError of kind aborted, not network', async () => {
    const s = await serve(() => { /* hang */ })
    try {
      const p = new OllamaEmbeddingProvider({ model: 'm', baseUrl: s.url })
      const ac = new AbortController()
      setTimeout(() => ac.abort(), 30)
      await expect(p.embed(['x'], ac.signal)).rejects.toMatchObject({ name: 'EmbeddingProviderError', kind: 'aborted' })
    } finally { await s.close() }
  })

  it('a non-loopback Ollama host is remote and is refused before any request is made', async () => {
    let fetched = 0
    const { svc } = await boot({ ollama: { model: 'm', baseUrl: 'http://ollama.lan:11434', fetch: (async () => { fetched++; throw new Error('should not be called') }) as typeof fetch } })
    expect(kind(await svc.embed(['private code']))).toBe('consent')
    expect(fetched).toBe(0)
  })

  it('loopback spellings are local', () => {
    for (const u of ['http://localhost:11434', 'http://127.0.0.1:1', 'http://127.1.2.3:1', 'http://[::1]:11434']) {
      expect(new OllamaEmbeddingProvider({ model: 'm', baseUrl: u }).egress.remote, u).toBe(false)
    }
    expect(new OllamaEmbeddingProvider({ model: 'm', baseUrl: 'http://10.0.0.5:11434' }).egress.remote).toBe(true)
  })
})

/* ------------------------- opt-in: the real thing, on a machine with Ollama */

const REAL_MODEL = process.env['HARNESS_OLLAMA_EMBED_MODEL']

describe.skipIf(!REAL_MODEL)(`real Ollama embeddings (${REAL_MODEL})`, () => {
  const cfg = (): EmbeddingsConfig => ({ ollama: { model: REAL_MODEL as string, timeoutMs: 300_000 }, prefixes: REAL_MODEL?.startsWith('nomic') ? { document: 'search_document: ', query: 'search_query: ' } : {} })

  it('is deterministic: the same string twice gives (near-)identical vectors', async () => {
    const { svc } = await boot(cfg())
    const a = ok(await svc.embed(['function to sort an array of numbers']))
    const b = ok(await svc.embed(['function to sort an array of numbers']))
    expect(cosine(a.vectors[0] as Float32Array, b.vectors[0] as Float32Array)).toBeGreaterThan(0.9999)
    expect(a.dimensions).toBeGreaterThan(0)
  })

  it('a batch of 20 is ONE request and returns 20 same-sized vectors', async () => {
    const { svc } = await boot(cfg())
    const r = ok(await svc.embed(Array.from({ length: 20 }, (_, i) => `sample text number ${i} about topic ${i % 4}`)))
    expect(r.requests).toBe(1)
    expect(r.vectors).toHaveLength(20)
    expect(new Set(r.vectors.map((v) => v.length)).size).toBe(1)
  })

  it('is semantically sensible: a paraphrase beats an unrelated text', async () => {
    const { svc } = await boot(cfg())
    const r = ok(await svc.embed(['sorts a list of numbers in ascending order', 'orders an array from smallest to largest', 'how to bake sourdough bread at home']))
    const [a, b, c] = r.vectors as [Float32Array, Float32Array, Float32Array]
    console.log(`paraphrase ${cosine(a, b).toFixed(3)} vs unrelated ${cosine(a, c).toFixed(3)}`)
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c))
  })
})
