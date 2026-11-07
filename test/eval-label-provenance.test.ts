import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hashGitIndexLabels, verifyCommittedLabels } from '../scripts/eval-label-provenance.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function cleanGitEnv() {
  const env = { ...process.env }
  for (const key of [
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_PREFIX',
    'GIT_CEILING_DIRECTORIES',
  ]) delete env[key]
  return env
}

function repoWithCommittedLabels(autocrlf = false, relativePath = 'labels.json') {
  const root = mkdtempSync(join(tmpdir(), 'eval-label-provenance-'))
  roots.push(root)
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], { cwd: root, env: cleanGitEnv() })
  execFileSync('git', ['config', 'user.name', 'Harness Test'], { cwd: root, env: cleanGitEnv() })
  execFileSync('git', ['config', 'user.email', 'harness-test@example.invalid'], { cwd: root })
  if (autocrlf) execFileSync('git', ['config', 'core.autocrlf', 'true'], { cwd: root })
  const labelsPath = join(root, ...relativePath.split('/'))
  mkdirSync(dirname(labelsPath), { recursive: true })
  const text = JSON.stringify({ session1: 'good', session2: 'bad' }, null, 2) + '\n'
  const labels = Buffer.from(autocrlf ? text.replace(/\n/g, '\r\n') : text)
  writeFileSync(labelsPath, labels)
  execFileSync('git', ['add', '--', relativePath], { cwd: root })
  const staged = execFileSync('git', ['show', ':' + relativePath], { cwd: root, env: cleanGitEnv() })
  const hash = createHash('sha256').update(staged).digest('hex')
  writeFileSync(labelsPath + '.sha256', hash + '  ' + basename(labelsPath) + '\n')
  execFileSync('git', ['add', '--', relativePath + '.sha256'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'blinded labels'], { cwd: root, stdio: 'ignore', env: cleanGitEnv() })
  return { root, labelsPath, hash }
}

describe('D-109 committed label provenance', () => {
  it('accepts exact, tracked and clean labels plus a matching SHA-256 sidecar', () => {
    const { labelsPath, hash } = repoWithCommittedLabels()
    expect(verifyCommittedLabels(labelsPath)).toMatchObject({ sha256: hash })
  })


  it('hashes the Git-normalized blob when a Windows-style CRLF worktree is clean', () => {
    const { labelsPath, hash } = repoWithCommittedLabels(true, 'docs/evidence/labels.json')
    expect(hashGitIndexLabels(labelsPath)).toBe(hash)
    expect(verifyCommittedLabels(labelsPath)).toMatchObject({ sha256: hash })
  })

  it('rejects labels changed after their commit, even when the sidecar is updated', () => {
    const { labelsPath } = repoWithCommittedLabels()
    const changed = Buffer.from(JSON.stringify({ session1: 'bad', session2: 'good' }, null, 2) + '\n')
    const hash = createHash('sha256').update(changed).digest('hex')
    writeFileSync(labelsPath, changed)
    writeFileSync(labelsPath + '.sha256', `${hash}  ${basename(labelsPath)}\n`)
    expect(() => verifyCommittedLabels(labelsPath)).toThrow(/clean working copy/)
  })

  it('rejects a mismatched committed sidecar', () => {
    const { root, labelsPath } = repoWithCommittedLabels()
    writeFileSync(labelsPath + '.sha256', '0000000000000000000000000000000000000000000000000000000000000000  labels.json\\n')
    execFileSync('git', ['add', '--', 'labels.json.sha256'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'tampered sidecar'], { cwd: root, stdio: 'ignore', env: cleanGitEnv() })
    expect(() => verifyCommittedLabels(labelsPath)).toThrow(/committed labels or SHA-256 sidecar differ/)
  })
})
