import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep, basename } from 'node:path'

/** True if `target` is `root` or lies under it. Both must already be real, absolute paths. */
export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  if (rel === '') return true
  if (isAbsolute(rel)) return false // a different drive on Windows
  return rel !== '..' && !rel.startsWith('..' + sep)
}

export class PathRefused extends Error {
  override name = 'PathRefused'
}

/**
 * Resolve a model-supplied path to a REAL absolute path inside `realRoot`, following symlinks.
 * The policy gate judges paths textually; this is the check that a symlink inside the project
 * cannot lead a write outside it. A path that does not exist yet is resolved through its nearest
 * existing ancestor, so `link-to-outside/new.txt` is refused too.
 */
export function confine(realRoot: string, p: string): string {
  if (typeof p !== 'string' || p.length === 0) throw new PathRefused('path is empty')
  if (p.includes('\0')) throw new PathRefused('path contains a NUL byte')
  const abs = resolve(realRoot, p)
  let existing = abs
  const tail: string[] = []
  while (!existsSync(existing)) {
    const up = dirname(existing)
    if (up === existing) break
    tail.unshift(basename(existing))
    existing = up
  }
  let real: string
  try {
    real = realpathSync(existing)
  } catch (e: any) {
    throw new PathRefused(`cannot resolve path "${p}": ${e?.message ?? e}`)
  }
  const full = tail.length ? join(real, ...tail) : real
  if (!isInside(realRoot, full)) throw new PathRefused(`path "${p}" is outside the project`)
  return full
}

/** Segments of `abs` relative to the root, lowercased, with forward slashes. */
export function relNorm(realRoot: string, abs: string): string {
  return relative(realRoot, abs).replace(/\\/g, '/').toLowerCase()
}

/** `.git` internals: never written through these tools, approval or not. */
export function isGitInternal(rel: string): boolean {
  return rel === '.git' || rel.startsWith('.git/') || rel.includes('/.git/') || rel.endsWith('/.git')
}

const SECRET_RE = /(^|\/)(\.env[^/]*|[^/]*\.env|[^/]*\.pem|[^/]*\.key|[^/]*\.p12|[^/]*\.pfx|id_rsa[^/]*|id_ed25519[^/]*|\.npmrc|\.netrc|credentials(\.json)?)$/

/** Likely-secret files, mirroring what retrieval already refuses to show the model. */
export function isSecretPath(rel: string): boolean {
  return SECRET_RE.test(rel)
}
