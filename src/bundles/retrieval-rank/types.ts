export interface RetrievalRankConfig {
  /** Absolute project root. Must be the same directory `retrievalGrep` is confined to. */
  root: string
  /** Vector-store collection holding indexed chunks. Default `'code-chunks'`. */
  collection?: string
  /** Results returned by default. Default 10. */
  k?: number
  /**
   * Share of the ranking decided by embedding similarity: 0 is pure BM25, 1 is pure vectors.
   * Applies only while embeddings and the vector store work; otherwise ranking is BM25-only. Default 0.5.
   */
  weight?: number
  /** Rank-fusion constant (larger flattens the difference between ranks). Default 60. */
  rrfK?: number
  /** How many nearest chunks to fetch from the vector store. Default 50. */
  vectorTopK?: number
  /**
   * Ignore vector hits whose cosine similarity is below this. A vector index always returns its
   * nearest neighbours, even when nothing in the project is relevant, so without a floor an
   * unrelated question still gets results. Off by default because a good value depends on the
   * embedding model (measured with nomic-embed-text: 0.75 for a paraphrase, 0.49 for unrelated
   * text); calibrate it with `scripts/smoke-phase2.ts`.
   */
  minVectorScore?: number
  /** Files larger than this are skipped. Default 1000000 bytes. */
  maxFileBytes?: number
  /** Window size for code outside symbols, in lines. Default 40. */
  windowLines?: number
  /** Longer symbols are split into windows of this many lines. Default 80. */
  maxChunkLines?: number
  /** Hard cap on one chunk's text. Default 6000 characters. */
  maxChunkChars?: number
  /** A symbol's name is added to its chunk this many extra times when scoring, so name matches win. Default 2. */
  nameBoost?: number
  /** BM25 parameters. Default k1 1.2, b 0.75. */
  bm25?: { k1: number; b: number }
  /** Stop collecting lexical candidates after this many chunks. Default 3000. */
  maxCandidateChunks?: number
  /** Each hit's `text` is cut to this many characters. Default 1500. */
  maxHitChars?: number
  /** Indexing embeds and stores chunks in groups of about this many. Default 512. */
  indexGroupChunks?: number
}

export interface SearchOptions {
  /** Return this many hits (1-100). */
  k?: number
  /** Restrict to a directory or file inside the root. */
  path?: string
  /** Override the configured embedding weight for this call (0-1). */
  weight?: number
  /** Override the configured similarity floor for this call (-1 to 1). */
  minVectorScore?: number
}

export interface RankHit {
  file: string
  startLine: number
  endLine: number
  kind: 'symbol' | 'window'
  name?: string
  /** Fused score (higher is better); only meaningful for ordering within one result. */
  score: number
  /** 1-based rank in the BM25 list, absent if the chunk had no lexical match. */
  bm25Rank?: number
  /** 1-based rank in the vector list, absent if the chunk was not among the nearest vectors. */
  vectorRank?: number
  /** Cosine similarity from the vector store. */
  vectorScore?: number
  text: string
}

export interface RankStats {
  candidateFiles: number
  candidateChunks: number
  /** Files that could not be read or chunked (binary, too large, unreadable, outside the root). */
  skippedFiles: number
  /** Vector hits dropped because the file changed after indexing. */
  staleVectorHits: number
  /** Vector hits dropped for being below `minVectorScore`. */
  belowFloorVectorHits: number
}

export type RankErrorKind = 'input' | 'outside_root' | 'path_not_found' | 'grep_failed'

export type RankResult =
  | {
      ok: true
      hits: RankHit[]
      /** `bm25`: lexical only. `hybrid`: vector similarity contributed. */
      mode: 'bm25' | 'hybrid'
      /** The embedding weight actually applied (0 when semantic ranking was unavailable or off). */
      weight: number
      /** Why semantic ranking was not used although it was wanted. */
      degraded?: string
      stats: RankStats
    }
  | { ok: false; error: { kind: RankErrorKind; detail: string } }

export interface IndexOptions {
  /** Drop the existing collection first (use after changing the embedding model). */
  reset?: boolean
  /**
   * Called after files that need no work are counted, and after each batch is stored, with
   * (chunks done, chunks total). Indexing a real project with a local model takes minutes (357 s
   * for 622 chunks measured), so a caller should show progress. Errors thrown here are ignored.
   */
  onProgress?: (done: number, total: number) => void
}

export interface IndexSkip {
  file: string
  reason: 'binary' | 'too_large' | 'unreadable' | 'outside_root' | 'not_a_file' | 'invalid_path'
}

export type IndexResult =
  | {
      ok: true
      /** Files whose chunks are now in the index (new work plus unchanged ones). */
      files: number
      /** Chunks now in the index for those files. */
      chunks: number
      /** Chunks that had to be embedded this time (the rest were already stored and unchanged). */
      embeddedChunks: number
      reusedFiles: number
      reusedChunks: number
      skipped: IndexSkip[]
    }
  | { ok: false; error: { kind: 'unavailable' | 'input' | 'embeddings' | 'vectorstore' | 'outside_root' | 'path_not_found' | 'grep_failed'; detail: string } }

/** Programmer error (bad config), not a ranking outcome. */
export class RetrievalRankConfigError extends Error {
  override name = 'RetrievalRankConfigError'
}
