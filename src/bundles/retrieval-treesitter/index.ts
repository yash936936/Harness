import { createRequire } from 'node:module'
import { dirname, join, extname } from 'node:path'
import { Context, Service } from 'cordis'
import { Language, Parser, type Node } from 'web-tree-sitter'
import {
  RetrievalTreesitterConfigError,
  type CodeSymbol,
  type ParseLanguage,
  type ParseTarget,
  type ParsedFile,
  type RetrievalParseResult,
  type RetrievalTreesitterConfig,
  type SymbolKind,
} from './types.js'

export * from './types.js'

declare module 'cordis' {
  interface Context {
    retrievalParse: RetrievalTreesitter
  }
}

const ALL_LANGUAGES: readonly ParseLanguage[] = ['typescript', 'tsx', 'javascript', 'python']

const EXTENSIONS: Readonly<Record<string, ParseLanguage>> = {
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.py': 'python',
}

/** Map a file name to a supported language, or `undefined`. Case-insensitive on the extension. */
export function languageForFilename(filename: string): ParseLanguage | undefined {
  return EXTENSIONS[extname(filename).toLowerCase()]
}

const SIGNATURE_CHARS = 200

let initPromise: Promise<void> | undefined
/** `Parser.init()` is process-global and must run exactly once. A failed init is not cached. */
function initRuntime(): Promise<void> {
  initPromise ??= Parser.init().catch((e) => {
    initPromise = undefined
    throw e
  })
  return initPromise
}

function defaultGrammarDir(): string {
  const require = createRequire(import.meta.url)
  return join(dirname(require.resolve('tree-sitter-wasms/package.json')), 'out')
}

/* ------------------------------------------------------------ extraction */

const named = (n: Node): Node[] => n.namedChildren.filter((c): c is Node => c !== null)
const field = (n: Node, f: string): Node | null => n.childForFieldName(f)

const FUNCTION_VALUES = new Set(['arrow_function', 'function_expression', 'function', 'generator_function'])

interface Ctx {
  source: string
  out: CodeSymbol[]
}

function push(c: Ctx, kind: SymbolKind, name: string, scope: string[], range: Node, sigNode: Node, exported: boolean): void {
  // Signature = declaration text up to its body (so one-liners don't leak their body), first line only.
  const body = sigNode.childForFieldName('body')
  const end = Math.min(body ? body.startIndex : sigNode.endIndex, sigNode.startIndex + SIGNATURE_CHARS * 2)
  const first = c.source.slice(sigNode.startIndex, end).split('\n')[0] ?? ''
  c.out.push({
    kind,
    name,
    qualifiedName: [...scope, name].join('.'),
    startLine: range.startPosition.row + 1,
    endLine: range.endPosition.row + 1,
    signature: first.trim().slice(0, SIGNATURE_CHARS),
    exported,
  })
}

/** A member/declaration name: identifiers as written, string keys unquoted; computed names are skipped. */
function nameOf(n: Node | null): string | undefined {
  if (!n) return undefined
  if (n.type === 'computed_property_name') return undefined
  const t = n.text
  return t.length >= 2 && /^['"`]/.test(t) ? t.slice(1, -1) : t
}

/**
 * `outer` is the node whose line range we report (includes `export`/decorators);
 * `inner` is the declaration itself (name, body, signature).
 */
function tsHandle(c: Ctx, inner: Node, outer: Node, scope: string[], exported: boolean): void {
  switch (inner.type) {
    case 'export_statement': {
      for (const child of named(inner)) tsHandle(c, child, inner, scope, true)
      return
    }
    case 'expression_statement': {
      // A top-level `namespace X {}` is parsed as an expression statement wrapping the module node.
      for (const child of named(inner)) if (child.type === 'internal_module' || child.type === 'module') tsHandle(c, child, outer, scope, exported)
      return
    }
    case 'ambient_declaration': {
      for (const child of named(inner)) tsHandle(c, child, outer, scope, exported)
      return
    }
    case 'function_declaration':
    case 'generator_function_declaration':
    case 'function_signature': {
      const name = nameOf(field(inner, 'name'))
      if (name) push(c, 'function', name, scope, outer, inner, exported)
      return
    }
    case 'class_declaration':
    case 'abstract_class_declaration': {
      const name = nameOf(field(inner, 'name'))
      if (!name) return
      push(c, 'class', name, scope, outer, inner, exported)
      const body = field(inner, 'body')
      if (body) for (const m of named(body)) tsMember(c, m, [...scope, name])
      return
    }
    case 'interface_declaration': {
      const name = nameOf(field(inner, 'name'))
      if (name) push(c, 'interface', name, scope, outer, inner, exported)
      return
    }
    case 'type_alias_declaration': {
      const name = nameOf(field(inner, 'name'))
      if (name) push(c, 'type', name, scope, outer, inner, exported)
      return
    }
    case 'enum_declaration': {
      const name = nameOf(field(inner, 'name'))
      if (name) push(c, 'enum', name, scope, outer, inner, exported)
      return
    }
    case 'internal_module':
    case 'module': {
      const nameNode = field(inner, 'name')
      // `declare module 'pkg' { ... }` augments ANOTHER module; its members do not live at `pkg.X`. Skip it.
      if (nameNode?.type === 'string') return
      const name = nameOf(nameNode)
      if (!name) return
      push(c, 'namespace', name, scope, outer, inner, exported)
      const body = field(inner, 'body')
      if (body) for (const child of named(body)) tsHandle(c, child, child, [...scope, name], false)
      return
    }
    case 'lexical_declaration':
    case 'variable_declaration': {
      for (const d of named(inner)) {
        if (d.type !== 'variable_declarator') continue
        const value = field(d, 'value')
        if (!value || !FUNCTION_VALUES.has(value.type)) continue
        const name = nameOf(field(d, 'name'))
        if (name) push(c, 'function', name, scope, outer, inner, exported)
      }
      return
    }
    default:
      return
  }
}

function tsMember(c: Ctx, m: Node, scope: string[]): void {
  switch (m.type) {
    case 'method_definition':
    case 'abstract_method_signature':
    case 'method_signature': {
      const name = nameOf(field(m, 'name'))
      if (name) push(c, 'method', name, scope, m, m, true)
      return
    }
    case 'public_field_definition': {
      const value = field(m, 'value')
      if (!value || !FUNCTION_VALUES.has(value.type)) return
      const name = nameOf(field(m, 'name'))
      if (name) push(c, 'method', name, scope, m, m, true)
      return
    }
    default:
      return
  }
}

function pyHandle(c: Ctx, inner: Node, outer: Node, scope: string[], inClass: boolean): void {
  switch (inner.type) {
    case 'decorated_definition': {
      const def = field(inner, 'definition')
      if (def) pyHandle(c, def, inner, scope, inClass)
      return
    }
    case 'function_definition': {
      const name = nameOf(field(inner, 'name'))
      if (name) push(c, inClass ? 'method' : 'function', name, scope, outer, inner, !name.startsWith('_'))
      return // nested functions are deliberately not descended into
    }
    case 'class_definition': {
      const name = nameOf(field(inner, 'name'))
      if (!name) return
      push(c, 'class', name, scope, outer, inner, !name.startsWith('_'))
      const body = field(inner, 'body')
      if (body) for (const child of named(body)) pyHandle(c, child, child, [...scope, name], true)
      return
    }
    default:
      return
  }
}

function extractSymbols(root: Node, source: string, language: ParseLanguage): CodeSymbol[] {
  const c: Ctx = { source, out: [] }
  for (const child of named(root)) {
    if (language === 'python') pyHandle(c, child, child, [], false)
    else tsHandle(c, child, child, [], false)
  }
  // Already in source order by construction: a declaration is pushed before the members it contains.
  return c.out
}

/* --------------------------------------------------------------- service */

/**
 * `ctx.retrievalParse` — the structural stage of the retrieval pipeline
 * (grep → **tree-sitter** → rank). Pure over the source text it is given:
 * it touches no filesystem paths other than its own grammar files, so callers
 * (not this bundle) decide which files may be read.
 */
export class RetrievalTreesitter extends Service {
  private readonly grammarDir: string
  private readonly allowed: ReadonlySet<ParseLanguage>
  private readonly maxBytes: number
  private readonly maxSymbols: number
  private readonly parsers = new Map<ParseLanguage, Parser>()
  private readonly grammarLoads = new Map<ParseLanguage, Promise<Parser>>()
  private disposed = false

  constructor(ctx: Context, config: RetrievalTreesitterConfig = {}) {
    super(ctx, 'retrievalParse')
    const langs = config.languages ?? [...ALL_LANGUAGES]
    for (const l of langs) {
      if (!ALL_LANGUAGES.includes(l)) throw new RetrievalTreesitterConfigError(`retrieval-treesitter: unsupported language ${JSON.stringify(l)}`)
    }
    this.allowed = new Set(langs)
    this.grammarDir = config.grammarDir ?? defaultGrammarDir()
    this.maxBytes = config.maxBytes ?? 524_288
    this.maxSymbols = config.maxSymbols ?? 2000
    // WASM-side memory is not garbage collected: free it when the plugin goes away.
    this.ctx.effect(() => () => this.disposeAll())
  }

  /** Languages whose grammar is currently loaded (for diagnostics and tests). */
  loadedLanguages(): ParseLanguage[] {
    return [...this.parsers.keys()].sort()
  }

  async parse(source: string, target: ParseTarget): Promise<RetrievalParseResult> {
    const language = target.language ?? (target.filename ? languageForFilename(target.filename) : undefined)
    if (!language || !this.allowed.has(language)) {
      return { ok: false, error: { kind: 'unsupported_language', detail: target.filename ?? target.language } }
    }
    if (source.length > this.maxBytes) {
      return { ok: false, error: { kind: 'too_large', detail: `${source.length} > ${this.maxBytes}` } }
    }

    let parser: Parser
    try {
      parser = await this.parserFor(language)
    } catch (e) {
      return { ok: false, error: { kind: 'grammar_unavailable', detail: e instanceof Error ? e.message : String(e) } }
    }
    if (this.disposed) return { ok: false, error: { kind: 'grammar_unavailable', detail: 'service disposed' } }

    let tree: ReturnType<Parser['parse']> = null
    try {
      tree = parser.parse(source)
      if (!tree) return { ok: false, error: { kind: 'parse_failed' } }
      const all = extractSymbols(tree.rootNode, source, language)
      const file: ParsedFile = {
        language,
        symbols: all.slice(0, this.maxSymbols),
        hasErrors: tree.rootNode.hasError,
        truncated: all.length > this.maxSymbols,
        lineCount: source === '' ? 0 : source.split('\n').length,
      }
      return { ok: true, file }
    } catch (e) {
      return { ok: false, error: { kind: 'parse_failed', detail: e instanceof Error ? e.message : String(e) } }
    } finally {
      tree?.delete() // the tree lives in WASM memory
    }
  }

  private parserFor(language: ParseLanguage): Promise<Parser> {
    const ready = this.parsers.get(language)
    if (ready) return Promise.resolve(ready)
    let pending = this.grammarLoads.get(language)
    if (!pending) {
      pending = (async () => {
        await initRuntime()
        const lang = await Language.load(join(this.grammarDir, `tree-sitter-${language}.wasm`))
        const parser = new Parser()
        parser.setLanguage(lang)
        if (this.disposed) {
          parser.delete()
          throw new Error('service disposed')
        }
        this.parsers.set(language, parser)
        return parser
      })()
      // A failed load is not cached, so a later call can retry.
      pending.catch(() => this.grammarLoads.delete(language))
      this.grammarLoads.set(language, pending)
    }
    return pending
  }

  private disposeAll(): void {
    this.disposed = true
    for (const p of this.parsers.values()) p.delete()
    this.parsers.clear()
    this.grammarLoads.clear()
  }
}

export const name = 'bundle-retrieval-treesitter'

export function apply(ctx: Context, config: RetrievalTreesitterConfig = {}): void {
  ctx.plugin(RetrievalTreesitter, config)
}
