// Safely resolve and read bounded, in-root source files for retrieval indexing.
import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { isGitInternal, isSecretPath } from '../tools-local/paths.js'
import { looksBinary, splitLines } from './chunk.js'
import type { IndexSkip } from './types.js'

export type FileRead = { ok: true; text: string; lines: string[] } | { ok: false; reason: IndexSkip['reason'] }

function readBoundedFd(fd: number, maxBytes: number): Buffer | undefined {
  const chunks: Buffer[] = []
  const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1))
  let total = 0
  while (total <= maxBytes) {
    const count = readSync(fd, chunk, 0, Math.min(chunk.length, maxBytes + 1 - total), null)
    if (count === 0) break
    total += count
    if (total > maxBytes) return undefined
    chunks.push(Buffer.from(chunk.subarray(0, count)))
  }
  return Buffer.concat(chunks, total)
}

export function canonicalPathKey(path: string): string {
  const absolute = resolve(path)
  if (process.platform !== 'win32') return absolute
  return absolute
    .replace(/^\\\\\\?\\UNC\\/i, '\\\\')
    .replace(/^\\\\\\?\\/, '')
    .replace(/[\\/]+$/, '')
    .toLowerCase()
}

export function sameCanonicalPath(a: string, b: string): boolean {
  return canonicalPathKey(a) === canonicalPathKey(b)
}

export function isInside(root: string, target: string): boolean {
  const rel = relative(canonicalPathKey(root), canonicalPathKey(target))
  if (rel === '') return true
  if (isAbsolute(rel)) return false
  return rel !== '..' && !rel.startsWith('..' + sep)
}

export function readProjectFile(rel: string, realRoot: string, maxFileBytes: number): FileRead {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0') || isAbsolute(rel)) return { ok: false, reason: 'invalid_path' }
  const candidate = resolve(realRoot, rel)
  let real: string
  try {
    const before = lstatSync(candidate)
    if (before.isSymbolicLink() || !before.isFile()) return { ok: false, reason: 'not_a_file' }
    real = realpathSync(candidate)
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  if (!isInside(realRoot, real)) return { ok: false, reason: 'outside_root' }
  const rootRelative = relative(canonicalPathKey(realRoot), canonicalPathKey(real)).split(sep).join('/').toLowerCase()
  if (isGitInternal(rootRelative) || rootRelative.split('/').includes('node_modules')) return { ok: false, reason: 'excluded' }
  if (isSecretPath(rootRelative)) return { ok: false, reason: 'secret' }
  try {
    const flags = fsConstants.O_RDONLY | (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0)
    const fd = openSync(real, flags)
    try {
      const opened = fstatSync(fd)
      if (!opened.isFile()) return { ok: false, reason: 'not_a_file' }
      if (opened.size > maxFileBytes) return { ok: false, reason: 'too_large' }

      // Re-resolve after open. A symlink can be swapped between the first
      // realpath and open; the descriptor must still name the in-root file.
      let currentReal: string
      try {
        currentReal = realpathSync(candidate)
      } catch {
        return { ok: false, reason: 'unreadable' }
      }
      if (!isInside(realRoot, currentReal)) return { ok: false, reason: 'outside_root' }
      const currentStat = statSync(currentReal)
      if (process.platform !== 'win32' && (currentStat.dev !== opened.dev || currentStat.ino !== opened.ino)) return { ok: false, reason: 'outside_root' }

      // Check the path once more after stat; if it changed during validation,
      // refuse rather than reading through a path whose identity is uncertain.
      const finalPath = lstatSync(candidate)
      const finalReal = realpathSync(candidate)
      if (finalPath.isSymbolicLink() || !finalPath.isFile() || !isInside(realRoot, finalReal) || !sameCanonicalPath(finalReal, currentReal)) return { ok: false, reason: 'outside_root' }

      const buf = readBoundedFd(fd, maxFileBytes)
      if (!buf) return { ok: false, reason: 'too_large' }
      if (looksBinary(buf)) return { ok: false, reason: 'binary' }
      const text = buf.toString('utf8')
      return { ok: true, text, lines: splitLines(text) }
    } finally {
      closeSync(fd)
    }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

