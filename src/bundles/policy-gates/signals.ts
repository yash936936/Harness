import { isAbsolute, relative, resolve } from 'node:path'
import type { Signal, SignalResult } from './types.js'

const PATH_KEYS = new Set(['path', 'paths', 'file', 'files', 'filepath', 'file_path', 'filename', 'target', 'destination', 'dest', 'dir', 'directory', 'cwd'])
// `old_string` counts: deleting a large block (empty new_string) is as big a change as writing one.
const CONTENT_KEYS = new Set(['content', 'contents', 'new_string', 'newstring', 'old_string', 'oldstring', 'text', 'patch', 'diff', 'data', 'body'])

/** Path-like values in the input, from well-known keys (top level and one level of nesting). */
export function pathsOf(input: unknown): string[] {
  const out: string[] = []
  const take = (v: unknown) => {
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) v.forEach(take)
  }
  const scan = (o: unknown, depth: number) => {
    if (!o || typeof o !== 'object' || depth > 2) return
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (PATH_KEYS.has(k.toLowerCase())) take(v)
      else if (v && typeof v === 'object') scan(v, depth + 1)
    }
  }
  scan(input, 0)
  return out
}

/** Longest content-like string in the input, in characters; undefined if there is none. */
export function contentLength(input: unknown): number | undefined {
  let best: number | undefined
  const scan = (o: unknown, depth: number) => {
    if (!o || typeof o !== 'object' || depth > 2) return
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (CONTENT_KEYS.has(k.toLowerCase()) && typeof v === 'string') best = Math.max(best ?? 0, v.length)
      else if (v && typeof v === 'object') scan(v, depth + 1)
    }
  }
  scan(input, 0)
  return best
}

const CRITICAL: [RegExp, number, string][] = [
  [/(^|\/)\.git(\/|$)/, 0.1, 'git internals'],
  [/(^|\/)\.github\/|(^|\/)\.gitlab-ci/, 0.3, 'CI configuration'],
  [/(^|\/)node_modules\//, 0.3, 'vendored dependencies'],
  [/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|cargo\.lock|poetry\.lock|gemfile\.lock|go\.sum)$/, 0.4, 'lockfile'],
  [/(^|\/)(package\.json|pyproject\.toml|cargo\.toml|go\.mod|requirements[^/]*\.txt|gemfile)$/, 0.5, 'dependency manifest'],
  [/(^|\/)(dockerfile|docker-compose[^/]*\.ya?ml)$/, 0.5, 'container configuration'],
  [/(^|\/)\.env[^/]*$/, 0.3, 'environment file'],
  [/(^|\/)(tsconfig[^/]*\.json|[^/]*\.config\.[a-z]+|\.eslintrc[^/]*|\.prettierrc[^/]*)$/, 0.6, 'tool configuration'],
]

/** How risky are the paths this call touches? Outside the project root = 0. The lowest-scoring path decides. */
export const pathCriticality: Signal = (ev, env) => {
  const paths = pathsOf(ev.input)
  if (!paths.length) return undefined
  let worst: SignalResult = { name: 'path-criticality', score: 1, note: 'ordinary project file(s)' }
  for (const p of paths) {
    const abs = resolve(env.projectRoot, p)
    const rel = relative(env.projectRoot, abs)
    if (rel.startsWith('..') || isAbsolute(rel)) return { name: 'path-criticality', score: 0, note: `"${p}" is outside the project root` }
    const norm = rel.replace(/\\/g, '/').toLowerCase()
    for (const [re, score, what] of CRITICAL) if (re.test(norm) && score < worst.score) worst = { name: 'path-criticality', score, note: `"${p}": ${what}` }
  }
  return worst
}

/** Bigger writes are riskier: 1.0 up to 2,000 characters, falling to 0.2 at 50,000 and beyond (log scale). */
export const diffSize: Signal = (ev) => {
  const n = contentLength(ev.input)
  if (n === undefined) return undefined
  const lo = Math.log10(2000), hi = Math.log10(50_000)
  const score = n <= 2000 ? 1 : Math.max(0.2, 1 - ((Math.log10(n) - lo) / (hi - lo)) * 0.8)
  return { name: 'diff-size', score: Math.round(score * 100) / 100, note: `${n} characters` }
}

export const BUILTIN_SIGNALS: readonly Signal[] = [pathCriticality, diffSize]
