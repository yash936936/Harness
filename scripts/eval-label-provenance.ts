import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * D-109: refuse to emit scorer output for labels unless the exact labels and
 * SHA-256 sidecar are already committed and the working copies are clean.
 */
export function verifyCommittedLabels(labelsPath: string): { sha256: string; commit: string } {
  const absolute = realpathSync(resolve(labelsPath))
  const sidecar = absolute + '.sha256'
  if (!existsSync(absolute) || !existsSync(sidecar)) {
    throw new Error('D-109: labels file and its .sha256 sidecar must exist and be committed before scoring')
  }

  let root: string
  try {
    root = realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dirname(absolute), encoding: 'utf8' }).trim())
  } catch {
    throw new Error('D-109: labels must be inside a Git repository')
  }
  const labelsRelative = relative(root, absolute).split(sep).join('/')
  const sidecarRelative = labelsRelative + '.sha256'
  if (!labelsRelative || labelsRelative === '..' || labelsRelative.startsWith(`..${sep}`) || isAbsolute(labelsRelative)) {
    throw new Error(`D-109: labels file must be inside the Git repository (root=${root}; relative=${labelsRelative})`)
  }

  const bytes = readFileSync(absolute)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const sidecarText = readFileSync(sidecar, 'utf8').trim()
  if (sidecarText !== `${sha256}  ${basename(absolute)}`) {
    throw new Error('D-109: labels SHA-256 sidecar does not match the current labels file')
  }

  try {
    execFileSync('git', ['cat-file', '-e', `HEAD:${labelsRelative}`], { cwd: root, stdio: 'ignore' })
    execFileSync('git', ['cat-file', '-e', `HEAD:${sidecarRelative}`], { cwd: root, stdio: 'ignore' })
  } catch {
    throw new Error('D-109: labels and SHA-256 sidecar must both be committed in HEAD')
  }
  const dirty = execFileSync('git', ['status', '--porcelain', '--', labelsRelative, sidecarRelative], { cwd: root, encoding: 'utf8' })
  if (dirty.trim()) throw new Error('D-109: labels and SHA-256 sidecar must be committed with a clean working copy')

  let committedLabels: Buffer
  let committedSidecar: string
  let commit: string
  try {
    committedLabels = execFileSync('git', ['show', `HEAD:${labelsRelative}`], { cwd: root })
    committedSidecar = execFileSync('git', ['show', `HEAD:${sidecarRelative}`], { cwd: root, encoding: 'utf8' }).trim()
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    throw new Error('D-109: labels and SHA-256 sidecar must exist in HEAD before scoring')
  }
  const committedHash = createHash('sha256').update(committedLabels).digest('hex')
  if (committedHash !== sha256 || committedSidecar !== sidecarText) {
    throw new Error('D-109: committed labels or SHA-256 sidecar differ from the working files')
  }
  return { sha256, commit }
}
