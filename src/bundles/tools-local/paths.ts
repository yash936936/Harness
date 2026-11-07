import { existsSync, realpathSync, statSync } from 'node:fs'
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

const SECRET_PATTERNS = [
  /(^|\/)\.env[^/]*$/i,
  /(^|\/)[^/]*\.env$/i,
  /(^|\/)\.aws\/(credentials|config)(?:$|\/)/i,
  /(^|\/)\.ssh(?:\/|$)/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(?!\.pub)[^/]*$/i,
  /(^|\/)\.(npmrc|netrc|pgpass|git-credentials)$/i,
  /(^|\/)\.docker\/config\.json$/i,
  /(^|\/)\.kube\/config$/i,
  /(^|\/)kubeconfig$/i,
  /(^|\/)[^/]*\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)credentials(?:\.json)?$/i,
  /(^|\/)service[-_]account[^/]*\.json$/i,
  /(^|\/)application_default_credentials\.json$/i,
  /(^|\/)secrets?\.(ya?ml|json|toml)$/i,
  /(^|\/)\.azure(?:\/|$)/i,
  /(^|\/)\.config\/gh\/hosts\.ya?ml$/i,
  /(^|\/)etc\/shadow$/i,
  /(^|\/)proc\/(self|[0-9]+)\/environ$/i,
]

/** Likely-secret files are refused by the local read tool even when policy gates are disabled. */
export function isSecretPath(rel: string): boolean {
  const normalized = rel.replace(/\\/g, '/').toLowerCase()
  return SECRET_PATTERNS.some((pattern) => pattern.test(normalized))
}

/** Identity of a directory at one moment: its real path plus device and inode. */
export interface DirIdentity {
  real: string
  dev: number | bigint
  ino: number | bigint
}

export function dirIdentity(dir: string): DirIdentity {
  const real = realpathSync(dir)
  const st = statSync(real)
  return { real, dev: st.dev, ino: st.ino }
}

/**
 * BUG-05: `confine()` validates a path at one instant; a concurrent process can swap a directory for a
 * symlink before the write lands. Capture `dirIdentity` right after validating, then call this just
 * before the file operation: it refuses if the directory is no longer the same directory, or is no
 * longer inside the root. This narrows the window to the few instructions between this check and the
 * syscall; closing it completely needs openat/O_NOFOLLOW on a directory handle, which Node does not expose.
 */
export function assertSameDir(realRoot: string, dir: string, id: DirIdentity): void {
  let now: DirIdentity
  try {
    now = dirIdentity(dir)
  } catch {
    throw new PathRefused('the target directory changed while the operation was running; refusing')
  }
  if (now.real !== id.real || now.dev !== id.dev || now.ino !== id.ino || !isInside(realRoot, now.real)) {
    throw new PathRefused('the target directory changed while the operation was running; refusing')
  }
}
