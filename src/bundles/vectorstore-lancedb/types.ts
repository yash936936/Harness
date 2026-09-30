export interface VectorRecord {
  /** Unique within the collection; writing an existing id replaces that record. 1-512 chars, no NUL. */
  id: string
  /** Must have exactly the collection's dimensions, be finite, and not be all zeros. */
  vector: ArrayLike<number>
  /**
   * What this record came from, typically a file path. Lets you replace or drop everything
   * from one file (`deleteSource`) and restrict a query to it. Up to 1024 chars, no NUL.
   */
  source?: string
  /** Any JSON object (a chunk's line range, symbol name, ...). Stored as JSON text, up to 65536 chars. */
  metadata?: Record<string, unknown>
}

export interface VectorHit {
  id: string
  /** Cosine similarity: 1 is identical direction, 0 unrelated, negative opposite. Higher is better. */
  score: number
  source?: string
  metadata?: Record<string, unknown>
}

export type VectorStoreErrorKind =
  | 'unavailable' // the native LanceDB module could not be loaded on this machine
  | 'input' // bad name, id, vector value, k, metadata ...
  | 'dimension_mismatch' // a vector's length is not the collection's dimensions
  | 'fingerprint_mismatch' // the stored collection was built with a different embedding model/setting
  | 'corrupt' // a table exists under that name but this store did not create it (or it is damaged)
  | 'closed' // the store or collection has been disposed
  | 'io'

export type VectorStoreFailure = { ok: false; error: { kind: VectorStoreErrorKind; detail: string } }
export type VectorStoreResult<T extends object> = ({ ok: true } & T) | VectorStoreFailure

export interface OpenCollectionOptions {
  /**
   * Identifies the embedding model and settings the vectors come from, e.g. the
   * `fingerprint` from `ctx.embeddings.info()`. Vectors from different models are
   * not comparable, so opening an existing collection with a different fingerprint fails.
   */
  fingerprint: string
  dimensions: number
  /** Drop any existing collection of this name first and start empty (use after changing the embedding model). */
  reset?: boolean
}

export interface VectorCollection {
  readonly name: string
  readonly fingerprint: string
  readonly dimensions: number
  /** Insert or replace by `id`. All records are validated first: either all are written or none. Duplicate ids within one call: the last wins. */
  upsert(records: readonly VectorRecord[]): Promise<VectorStoreResult<{ written: number }>>
  /** The `k` most similar records (1..1000), best first; ties broken by id. */
  query(vector: ArrayLike<number>, k: number, opts?: { source?: string }): Promise<VectorStoreResult<{ hits: VectorHit[] }>>
  /** Returns how many records were removed. Ids that do not exist are ignored. */
  deleteIds(ids: readonly string[]): Promise<VectorStoreResult<{ deleted: number }>>
  /** Remove every record that came from `source`. */
  deleteSource(source: string): Promise<VectorStoreResult<{ deleted: number }>>
  count(): Promise<VectorStoreResult<{ count: number }>>
}

export interface VectorStoreConfig {
  /** Absolute directory for the database; created if missing. */
  path: string
}

/** Programmer error (bad config), not a storage outcome. */
export class VectorStoreConfigError extends Error {
  override name = 'VectorStoreConfigError'
}
