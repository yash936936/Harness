import { Context, Service } from 'cordis'
import { OllamaEmbeddingProvider } from './providers/ollama.js'
import {
  EmbeddingProviderError,
  EmbeddingsConfigError,
  type EmbedOptions,
  type EmbedResult,
  type EmbeddingProvider,
  type EmbeddingsConfig,
  type EmbeddingsErrorKind,
  type EmbeddingsInfo,
} from './types.js'

export * from './types.js'
export { OllamaEmbeddingProvider } from './providers/ollama.js'
export { HashingEmbeddingProvider } from './providers/hashing.js'

declare module 'cordis' {
  interface Context {
    embeddings: Embeddings
  }
}

const fail = (kind: EmbeddingsErrorKind, detail: string): EmbedResult => ({ ok: false, error: { kind, detail } })

/** Cut to at most `max` UTF-16 units without splitting a surrogate pair. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

function l2normalize(v: Float32Array): Float32Array {
  let sum = 0
  for (const x of v) sum += x * x
  const norm = Math.sqrt(sum)
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] = (v[i] as number) / norm
  return v
}

/**
 * `ctx.embeddings` — text to vectors, batched. One active provider at a time
 * (vectors from different models are not comparable). Every failure is a
 * result value: callers such as the ranker are expected to fall back to BM25.
 *
 * A provider that would send text off this machine is refused until the egress
 * gate is wired in (D-054); local Ollama is the supported provider.
 */
export class Embeddings extends Service {
  private provider: EmbeddingProvider | undefined
  private dimensions: number | undefined
  private readonly maxBatchSize: number
  private readonly maxBatchChars: number
  private readonly maxInputChars: number
  private readonly normalize: boolean
  private readonly prefixes: { document: string; query: string }

  constructor(ctx: Context, config: EmbeddingsConfig = {}) {
    super(ctx, 'embeddings')
    this.maxBatchSize = config.maxBatchSize ?? 32
    this.maxBatchChars = config.maxBatchChars ?? 64_000
    this.maxInputChars = config.maxInputChars ?? 8_000
    for (const [k, v] of [['maxBatchSize', this.maxBatchSize], ['maxBatchChars', this.maxBatchChars], ['maxInputChars', this.maxInputChars]] as const) {
      if (!Number.isInteger(v) || v < 1) throw new EmbeddingsConfigError(`embeddings: ${k} must be a positive integer`)
    }
    this.normalize = config.normalize ?? true
    this.prefixes = { document: config.prefixes?.document ?? '', query: config.prefixes?.query ?? '' }
    if (config.ollama) this.provider = new OllamaEmbeddingProvider(config.ollama)
  }

  /** Register the provider. Returns a disposer; call it inside `ctx.effect` so it unregisters with its plugin. */
  register(provider: EmbeddingProvider): () => void {
    if (this.provider) throw new EmbeddingsConfigError(`embeddings: provider "${this.provider.name}" is already registered`)
    this.provider = provider
    this.dimensions = undefined
    return () => {
      if (this.provider === provider) {
        this.provider = undefined
        this.dimensions = undefined
      }
    }
  }

  info(): EmbeddingsInfo | undefined {
    const p = this.provider
    if (!p) return undefined
    return {
      provider: p.name,
      model: p.model,
      ...(this.dimensions !== undefined
        ? { dimensions: this.dimensions, fingerprint: `${p.name}:${p.model}:${this.dimensions}` }
        : {}),
    }
  }

  async embed(texts: readonly string[], opts: EmbedOptions = {}): Promise<EmbedResult> {
    const provider = this.provider
    if (!provider) return fail('config', 'no embedding provider registered')

    for (let i = 0; i < texts.length; i++) {
      const t = texts[i]
      if (typeof t !== 'string' || t.trim() === '') return fail('input', `text at index ${i} is empty or not a string`)
    }
    if (provider.egress.remote) {
      return fail('consent', `${provider.name}: refused to send text to ${provider.egress.host}; remote embedding providers need the egress gate, which is not wired in yet`)
    }
    if (texts.length === 0) return { ok: true, vectors: [], model: provider.model, dimensions: this.dimensions ?? 0, requests: 0, truncated: 0, unique: 0 }

    // Truncate, prefix, then embed each distinct text once.
    const prefix = this.prefixes[opts.kind ?? 'document']
    let truncated = 0
    const index = new Map<string, number>()
    const unique: string[] = []
    const slot: number[] = texts.map((raw) => {
      const cut = clip(raw, this.maxInputChars)
      if (cut.length < raw.length) truncated++
      const prepared = prefix + cut
      let i = index.get(prepared)
      if (i === undefined) {
        i = unique.length
        index.set(prepared, i)
        unique.push(prepared)
      }
      return i
    })

    // Greedy batches bounded by count and characters.
    const batches: string[][] = []
    let cur: string[] = []
    let chars = 0
    for (const t of unique) {
      if (cur.length > 0 && (cur.length >= this.maxBatchSize || chars + t.length > this.maxBatchChars)) {
        batches.push(cur)
        cur = []
        chars = 0
      }
      cur.push(t)
      chars += t.length
    }
    if (cur.length) batches.push(cur)

    const vectors: Float32Array[] = []
    let requests = 0
    let dims: number | undefined
    for (const batch of batches) {
      if (opts.signal?.aborted) return fail('aborted', 'aborted before the request was sent')
      let raw: ReadonlyArray<ArrayLike<number>>
      try {
        requests++
        raw = await provider.embed(batch, opts.signal)
      } catch (e: any) {
        if (opts.signal?.aborted) return fail('aborted', 'aborted')
        if (e instanceof EmbeddingProviderError) return fail(e.kind, e.message)
        return fail('unknown', `${provider.name}: ${e?.message ?? String(e)}`)
      }
      if (!Array.isArray(raw) || raw.length !== batch.length) {
        return fail('malformed', `${provider.name}: sent ${batch.length} texts, got ${Array.isArray(raw) ? raw.length : 'no'} vectors back`)
      }
      for (const r of raw) {
        const v = Float32Array.from(r)
        if (v.length === 0 || !v.every(Number.isFinite)) return fail('malformed', `${provider.name}: empty or non-finite vector`)
        dims ??= v.length
        if (v.length !== dims) return fail('malformed', `${provider.name}: vectors in one response have different lengths (${dims} vs ${v.length})`)
        vectors.push(this.normalize ? l2normalize(v) : v)
      }
      if (this.dimensions !== undefined && dims !== this.dimensions) {
        return fail('dimension_mismatch', `${provider.name}/${provider.model} returned ${dims}-dimensional vectors, previously ${this.dimensions}; stored vectors would be incomparable`)
      }
    }
    this.dimensions ??= dims

    return {
      ok: true,
      vectors: slot.map((i) => vectors[i] as Float32Array),
      model: provider.model,
      dimensions: dims as number,
      requests,
      truncated,
      unique: unique.length,
    }
  }
}

export const name = 'bundle-embeddings'

export function apply(ctx: Context, config: EmbeddingsConfig = {}): void {
  ctx.plugin(Embeddings, config)
}
