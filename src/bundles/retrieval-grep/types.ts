export interface RetrievalGrepConfig {
  /** Absolute path of the directory searches are confined to. Required. */
  root: string
  /** ripgrep executable. Default `'rg'` (resolved via PATH). */
  rgPath?: string
  /**
   * Extra ripgrep arguments (ignore globs etc.). Config-only, never model-controlled.
   * Placed BEFORE the built-in secret/vendor excludes so they cannot re-include them.
   */
  extraArgs?: string[]
  /** Max files returned. Default 200. */
  maxResults?: number
  /** Max match lines kept per file (the true count is still reported). Default 5. */
  maxMatchesPerFile?: number
  /**
   * Search hidden files and do NOT exclude likely-secret files (.env*, *.pem,
   * *.key, id_rsa*). Config-only; there is deliberately no per-call switch.
   * `.git` and `node_modules` stay excluded regardless. Default false.
   */
  includeSecrets?: boolean
  /** ripgrep timeout in ms. Default 10000. */
  timeoutMs?: number
}

export interface SearchOptions {
  /** Directory or file to search, resolved relative to `root`. Must stay inside `root`. */
  path?: string
  /** Treat the query as a literal string (`-F`). */
  fixedStrings?: boolean
  /** Force case-sensitive (`-s`). Default is smart-case (`-S`). */
  caseSensitive?: boolean
}

export interface SearchMatch {
  /** 1-based line number. */
  line: number
  /** Line text, trailing whitespace removed, cut to 300 chars. */
  text: string
}

export interface SearchResult {
  /** Path relative to `root`, forward slashes. */
  file: string
  /** First `maxMatchesPerFile` matches. */
  matches: SearchMatch[]
  /** Total matching lines in the file (uncapped); this is what results are ranked by. */
  matchCount: number
}

export type RetrievalGrepErrorKind =
  | 'outside_root'
  | 'path_not_found'
  | 'rg_missing'
  | 'timeout'
  | 'bad_pattern'
  | 'rg_failed'

export type RetrievalGrepResult =
  | {
      ok: true
      results: SearchResult[]
      /** True if more files matched than `maxResults` (the tail was dropped), or rg output hit the capture cap. */
      truncated: boolean
    }
  | { ok: false; error: { kind: RetrievalGrepErrorKind; detail?: string } }

/** Programmer error (bad config), not a search outcome. */
export class RetrievalGrepConfigError extends Error {
  override name = 'RetrievalGrepConfigError'
}
