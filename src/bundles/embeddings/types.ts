import type { EgressInfo } from '../model-adapter/types.js'

export type { EgressInfo }

/** Some models want different task prefixes for the text being indexed vs. the text being searched for. */
export type EmbedKind = 'document' | 'query'

export type EmbeddingsErrorKind =
  | 'config' // no provider registered
  | 'input' // an empty / non-string text
  | 'consent' // the provider would send text off this machine (not yet supported, see D-054)
  | 'network'
  | 'timeout'
  | 'model_missing'
  | 'server'
  | 'malformed' // response did not have the promised shape
  | 'dimension_mismatch' // vector length differs from what this provider returned before
  | 'aborted'
  | 'unknown'

/**
 * One embedding backend. `embed` gets a batch and must return exactly one vector
 * per text, in order. Providers throw {@link EmbeddingProviderError}; the service
 * turns every failure into a result value.
 */
export interface EmbeddingProvider {
  readonly name: string
  /** Exact model id; part of the fingerprint vectors are stored under. */
  readonly model: string
  /** Where the texts go. `remote: true` means they leave this machine. */
  readonly egress: EgressInfo
  embed(texts: readonly string[], signal?: AbortSignal): Promise<ReadonlyArray<ArrayLike<number>>>
}

export class EmbeddingProviderError extends Error {
  override name = 'EmbeddingProviderError'
  constructor(
    public kind: EmbeddingsErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message)
  }
}

/** Programmer error (bad config), not an embedding outcome. */
export class EmbeddingsConfigError extends Error {
  override name = 'EmbeddingsConfigError'
}

export interface OllamaEmbedConfig {
  /** Required: an installed embedding model tag. There is deliberately no default; model choice is configuration. */
  model: string
  /** Falls back to OLLAMA_HOST, then http://localhost:11434. */
  baseUrl?: string
  /** Default 120000 (the first call may load the model). */
  timeoutMs?: number
  /** Ollama `keep_alive`, e.g. `'10m'`. Unset uses Ollama's default. */
  keepAlive?: string
  /** Injectable for tests. */
  fetch?: typeof fetch
}

export interface EmbeddingsConfig {
  /** Convenience: build and register an Ollama provider. Other providers use `register()`. */
  ollama?: OllamaEmbedConfig
  /** Max texts per provider call. Default 32. */
  maxBatchSize?: number
  /** Max total characters per provider call (a single longer text still goes alone). Default 64000. */
  maxBatchChars?: number
  /** Texts longer than this are cut before embedding (and counted in `truncated`). Default 8000. */
  maxInputChars?: number
  /** L2-normalise every vector (cosine == dot product afterwards). Default true. */
  normalize?: boolean
  /** Prepended to each text by `kind`, e.g. nomic-embed-text wants `search_document: ` / `search_query: `. */
  prefixes?: { document?: string; query?: string }
}

export interface EmbedOptions {
  /** Default `'document'`. */
  kind?: EmbedKind
  signal?: AbortSignal
}

export type EmbedResult =
  | {
      ok: true
      /** One per input text, in input order. */
      vectors: Float32Array[]
      model: string
      dimensions: number
      /** Provider calls made (identical texts are sent once; the rest are batched). */
      requests: number
      /** Inputs cut to `maxInputChars`. */
      truncated: number
      /** Distinct texts actually embedded. */
      unique: number
    }
  | { ok: false; error: { kind: EmbeddingsErrorKind; detail: string } }

export interface EmbeddingsInfo {
  provider: string
  model: string
  /** Known after the first successful call. */
  dimensions?: number
  /** `provider:model:dimensions`; a vector store must key its data on this, since vectors from different models are not comparable. */
  fingerprint?: string
}
