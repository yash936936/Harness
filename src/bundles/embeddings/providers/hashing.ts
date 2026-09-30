import type { EgressInfo, EmbeddingProvider } from '../types.js'

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** camelCase / snake_case / kebab-case aware word split, lower-cased. */
function words(text: string): string[] {
  return text.replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

/**
 * Feature-hashing "embeddings": every word adds +/-1 to one of `dims` buckets.
 * Deterministic, offline, needs no model. Texts that share words get a higher
 * cosine similarity, but there is NO semantic understanding (synonyms score 0).
 * It exists so the retrieval pipeline and its tests can run without a model;
 * do not treat it as a quality baseline.
 */
export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'hashing'
  readonly model: string
  readonly egress: EgressInfo = { host: 'localhost', remote: false }
  private readonly dims: number

  constructor(config: { dimensions?: number } = {}) {
    this.dims = config.dimensions ?? 256
    if (!Number.isInteger(this.dims) || this.dims < 8) throw new RangeError('hashing embeddings: dimensions must be an integer >= 8')
    this.model = `hashing-${this.dims}`
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array<number>(this.dims).fill(0)
      const toks = words(t)
      for (const tok of toks.length ? toks : [t]) {
        const i = fnv1a(tok) % this.dims
        v[i] = (v[i] ?? 0) + ((fnv1a('#' + tok) & 1) === 1 ? 1 : -1)
      }
      return v
    })
  }
}
