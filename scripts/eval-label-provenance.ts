import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'

function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  // A parent Git process/runner may export repository overrides. Ignore them so
  // discovery is based on the labels file's actual directory.
  for (const key of [
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_PREFIX',
    'GIT_CEILING_DIRECTORIES',
  ]) delete env[key]
  return env
}

/**
 * D-109: refuse to emit scorer output for labels unless the exact labels and
 * SHA-256 sidecar are already committed and the working copies are clean.
 */
export function verifyCommittedLabels(labelsPath: string): { sha256: string; commit: string } {
  const requested = resolve(labelsPath)
  const requestedSidecar = requested + '.sha256'
  if (!existsSync(requested) || !existsSync(requestedSidecar)) {
    throw new Error('D-109: labels file and its .sha256 sidecar must exist and be committed before scoring')
  }
  if (lstatSync(requested).isSymbolicLink() || !lstatSync(requested).isFile()) {
    throw new Error('D-109: labels file must be a regular file, not a symlink')
  }
  const absolute = realpathSync(requested)
  const sidecar = requestedSidecar

  let root: string
  try {
    root = realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dirname(absolute), encoding: 'utf8', env: cleanGitEnv() }).trim())
  } catch {
    throw new Error('D-109: labels must be inside a Git repository')
  }
  // Ask Git for the repository-relative directory instead of comparing Windows
  // real paths: runners may expose the same temp directory through 8.3 aliases.
  const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], { cwd: dirname(absolute), encoding: 'utf8', env: cleanGitEnv() }).trim().replace(/\\/g, '/')
  const labelsRelative = [prefix.replace(/\/+$/, ''), basename(absolute)].filter(Boolean).join('/')
  const sidecarRelative = labelsRelative + '.sha256'
  if (!labelsRelative || labelsRelative.split('/').some((part) => part === '..') || isAbsolute(labelsRelative)) {
    throw new Error(`D-109: labels file must be inside the Git repository (root=${root}; relative=${labelsRelative})`)
  }

  if (lstatSync(sidecar).isSymbolicLink() || !lstatSync(sidecar).isFile()) {
    throw new Error('D-109: labels SHA-256 sidecar must be a regular file, not a symlink')
  }
  const bytes = readFileSync(absolute)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const sidecarText = readFileSync(sidecar, 'utf8').trim()
  if (sidecarText !== `${sha256}  ${basename(absolute)}`) {
    throw new Error('D-109: labels SHA-256 sidecar does not match the current labels file')
  }

  let committedPaths: string[]
  try {
    committedPaths = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8', env: cleanGitEnv() }).split(/\r?\n/)
  } catch {
    throw new Error('D-109: could not inspect the committed Git tree for labels')
  }
  if (!committedPaths.includes(labelsRelative) || !committedPaths.includes(sidecarRelative)) {
    throw new Error(`D-109: labels and SHA-256 sidecar must both be committed in HEAD (labels=${labelsRelative}; sidecar=${sidecarRelative}; tree=${JSON.stringify(committedPaths)})`)
  }
  const dirty = execFileSync('git', ['status', '--porcelain', '--', labelsRelative, sidecarRelative], { cwd: root, encoding: 'utf8', env: cleanGitEnv() })
  if (dirty.trim()) throw new Error('D-109: labels and SHA-256 sidecar must be committed with a clean working copy')

  let committedLabels: Buffer
  let committedSidecar: string
  let commit: string
  try {
    committedLabels = execFileSync('git', ['show', `HEAD:${labelsRelative}`], { cwd: root, env: cleanGitEnv() })
    committedSidecar = execFileSync('git', ['show', `HEAD:${sidecarRelative}`], { cwd: root, encoding: 'utf8', env: cleanGitEnv() }).trim()
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', env: cleanGitEnv() }).trim()
  } catch {
    throw new Error('D-109: labels and SHA-256 sidecar must exist in HEAD before scoring')
  }
  const committedHash = createHash('sha256').update(committedLabels).digest('hex')
  if (committedHash !== sha256 || committedSidecar !== sidecarText) {
    throw new Error('D-109: committed labels or SHA-256 sidecar differ from the working files')
  }
  return { sha256, commit }
}
