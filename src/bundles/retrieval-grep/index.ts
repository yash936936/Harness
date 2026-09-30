import { isAbsolute, relative, resolve, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import { Context, Service } from 'cordis'
import {
  RetrievalGrepConfigError,
  type RetrievalGrepConfig,
  type RetrievalGrepResult,
  type SearchMatch,
  type SearchOptions,
  type SearchResult,
} from './types.js'

export * from './types.js'

declare module 'cordis' {
  interface Context {
    retrievalGrep: RetrievalGrep
  }
}

const MAX_LINE_CHARS = 300

/** Never searched, regardless of config. */
const ALWAYS_EXCLUDED = ['!.git', '!node_modules']
/** Likely-secret files; excluded unless `includeSecrets`. */
const SECRET_EXCLUDES = ['!.env*', '!*.env', '!*.pem', '!*.key', '!id_rsa*']

/** True if `target` is `root` or lies under it. Both must already be real, absolute paths. */
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  if (rel === '') return true
  if (isAbsolute(rel)) return false // different drive on Windows
  return rel !== '..' && !rel.startsWith('..' + sep)
}

/**
 * Parse `rg --json` output. Only `match` events are used; every field is under
 * `data`. Entries whose path/text are `{bytes}` (non-UTF-8) are skipped.
 * `root` must be the real (symlink-resolved) root that rg's paths are under.
 */
export function parseRgJson(
  stdout: string,
  root: string,
  limits: { maxMatchesPerFile: number; maxResults: number },
): { results: SearchResult[]; truncated: boolean } {
  const files = new Map<string, { matches: SearchMatch[]; total: number }>()
  for (const raw of stdout.split('\n')) {
    if (!raw.trim()) continue
    let ev: any
    try {
      ev = JSON.parse(raw)
    } catch {
      continue // malformed (e.g. output cut at the capture cap)
    }
    if (ev?.type !== 'match') continue
    const path: unknown = ev.data?.path?.text
    const text: unknown = ev.data?.lines?.text
    const line: unknown = ev.data?.line_number
    if (typeof path !== 'string' || typeof text !== 'string' || typeof line !== 'number') continue
    const abs = resolve(root, path)
    if (!isInside(root, abs)) continue
    const file = relative(root, abs).split(sep).join('/')
    let entry = files.get(file)
    if (!entry) files.set(file, (entry = { matches: [], total: 0 }))
    entry.total++
    if (entry.matches.length < limits.maxMatchesPerFile) {
      entry.matches.push({ line, text: text.trimEnd().slice(0, MAX_LINE_CHARS) })
    }
  }
  const all = [...files.entries()]
    .map(([file, e]): SearchResult => ({ file, matches: e.matches, matchCount: e.total }))
    .sort((a, b) => b.matchCount - a.matchCount || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
  return { results: all.slice(0, limits.maxResults), truncated: all.length > limits.maxResults }
}

/**
 * `ctx.retrievalGrep` — the cheap first stage of the retrieval pipeline
 * (grep → tree-sitter → rank). Runs ripgrep through `ctx.subprocess`.
 */
export class RetrievalGrep extends Service {
  static inject = ['subprocess']

  private readonly root: string
  private readonly rgPath: string
  private readonly extraArgs: string[]
  private readonly maxResults: number
  private readonly maxMatchesPerFile: number
  private readonly includeSecrets: boolean
  private readonly timeoutMs: number

  constructor(ctx: Context, config: RetrievalGrepConfig) {
    super(ctx, 'retrievalGrep')
    if (!config?.root || !isAbsolute(config.root)) {
      throw new RetrievalGrepConfigError('retrieval-grep: config.root must be an absolute path')
    }
    this.root = config.root
    this.rgPath = config.rgPath ?? 'rg'
    this.extraArgs = config.extraArgs ?? []
    this.maxResults = config.maxResults ?? 200
    this.maxMatchesPerFile = config.maxMatchesPerFile ?? 5
    this.includeSecrets = config.includeSecrets ?? false
    this.timeoutMs = config.timeoutMs ?? 10_000
  }

  async search(query: string, opts: SearchOptions = {}): Promise<RetrievalGrepResult> {
    if (query === '' || query.includes('\0')) {
      return { ok: false, error: { kind: 'bad_pattern', detail: 'empty query or NUL byte' } }
    }

    let realRoot: string
    let target: string
    try {
      realRoot = realpathSync(this.root)
    } catch {
      return { ok: false, error: { kind: 'path_not_found', detail: 'root does not exist' } }
    }
    try {
      target = realpathSync(resolve(realRoot, opts.path ?? '.'))
    } catch {
      return { ok: false, error: { kind: 'path_not_found' } }
    }
    if (!isInside(realRoot, target)) return { ok: false, error: { kind: 'outside_root' } }

    const args = ['--json', '--no-config', opts.caseSensitive ? '-s' : '-S']
    if (opts.fixedStrings) args.push('-F')
    if (this.includeSecrets) args.push('--hidden')
    args.push(...this.extraArgs)
    // Later --glob wins in ripgrep, so these come after extraArgs on purpose.
    for (const g of ALWAYS_EXCLUDED) args.push('--glob', g)
    if (!this.includeSecrets) for (const g of SECRET_EXCLUDES) args.push('--glob', g)
    args.push('-e', query, '--', target)

    const res = await this.ctx.subprocess.run(this.rgPath, args, { cwd: realRoot, timeoutMs: this.timeoutMs })

    if (res.spawnError) return { ok: false, error: { kind: 'rg_missing', detail: res.spawnError } }
    if (res.timedOut) return { ok: false, error: { kind: 'timeout' } }

    const parsed = parseRgJson(res.stdout, realRoot, {
      maxMatchesPerFile: this.maxMatchesPerFile,
      maxResults: this.maxResults,
    })

    if (res.exitCode === 0 || res.exitCode === 1 || (res.exitCode === 2 && parsed.results.length > 0)) {
      // exit 1 = no match; exit 2 with matches = some files unreadable, still useful
      return { ok: true, results: parsed.results, truncated: parsed.truncated || res.stdoutTruncated }
    }
    if (res.exitCode === 2) {
      return { ok: false, error: { kind: 'bad_pattern', detail: res.stderr.trim().slice(0, 300) } }
    }
    return { ok: false, error: { kind: 'rg_failed', detail: `exit ${res.exitCode ?? 'null'} signal ${res.signal ?? 'none'}` } }
  }
}

export const name = 'bundle-retrieval-grep'

export function apply(ctx: Context, config: RetrievalGrepConfig): void {
  ctx.plugin(RetrievalGrep, config)
}
