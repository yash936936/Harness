export type ParseLanguage = 'typescript' | 'tsx' | 'javascript' | 'python'

export type SymbolKind = 'function' | 'class' | 'method' | 'interface' | 'type' | 'enum' | 'namespace'

export interface CodeSymbol {
  kind: SymbolKind
  /** Bare name, e.g. `search`. */
  name: string
  /** Dotted path through enclosing classes/namespaces, e.g. `RetrievalGrep.search`. */
  qualifiedName: string
  /** 1-based, inclusive. Covers decorators / `export` / leading modifiers. */
  startLine: number
  endLine: number
  /** First line of the declaration, trimmed, cut to 200 chars. */
  signature: string
  /** `export`ed (TS/JS) or not underscore-prefixed (Python). */
  exported: boolean
}

export interface ParsedFile {
  language: ParseLanguage
  /** Sorted by `startLine`, then nesting order. */
  symbols: CodeSymbol[]
  /** The grammar reported syntax errors; symbols are best-effort. */
  hasErrors: boolean
  /** More symbols existed than `maxSymbols`. */
  truncated: boolean
  lineCount: number
}

export type RetrievalParseErrorKind = 'unsupported_language' | 'too_large' | 'grammar_unavailable' | 'parse_failed'

export type RetrievalParseResult =
  | { ok: true; file: ParsedFile }
  | { ok: false; error: { kind: RetrievalParseErrorKind; detail?: string } }

export interface RetrievalTreesitterConfig {
  /** Directory holding `tree-sitter-<language>.wasm`. Default: the `tree-sitter-wasms` package's `out/`. */
  grammarDir?: string
  /** Languages this instance will accept. Default: all supported. */
  languages?: ParseLanguage[]
  /** Refuse sources larger than this many UTF-16 code units. Default 524288. */
  maxBytes?: number
  /** Cap on returned symbols. Default 2000. */
  maxSymbols?: number
}

/** What to parse as: an explicit language, or infer it from a file name. `language` wins. */
export interface ParseTarget {
  language?: ParseLanguage
  filename?: string
}

/** Programmer error (bad config), not a parse outcome. */
export class RetrievalTreesitterConfigError extends Error {
  override name = 'RetrievalTreesitterConfigError'
}
