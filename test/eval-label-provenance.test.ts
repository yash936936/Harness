import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyCommittedLabels } from '../scripts/eval-label-provenance.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function repoWithCommittedLabels() {
  const root = mkdtempSync(join(tmpdir(), 'eval-label-provenance-'))
  roots.push(root)
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Harness Test'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'harness-test@example.invalid'], { cwd: root })
  const labelsPath = join(root, 'labels.json')
  const labels = Buffer.from(JSON.stringify({ session1: 'good', session2: 'bad' }, null, 2) + '\n')
  const hash = createHash('sha256').update(labels).digest('hex')
  writeFileSync(labelsPath, labels)
  writeFileSync(labelsPath + '.sha256', `${hash}  ${basename(labelsPath)}\n`)
  execFileSync('git', ['add', '--', 'labels.json', 'labels.json.sha256'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'blinded labels'], { cwd: root, stdio: 'ignore' })
  return { root, labelsPath, labels, hash }
}

describe('D-109 committed label provenance', () => {
  it('accepts exact, tracked and clean labels plus a matching SHA-256 sidecar', () => {
    const { labelsPath, hash } = repoWithCommittedLabels()
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

  it('rejects a mismatched sidecar', () => {
    const { labelsPath } = repoWithCommittedLabels()
    writeFileSync(labelsPath + '.sha256', `0000000000000000000000000000000000000000000000000000000000000000  labels.json\n`)
    expect(() => verifyCommittedLabels(labelsPath)).toThrow(/sidecar does not match/)
  })
})
