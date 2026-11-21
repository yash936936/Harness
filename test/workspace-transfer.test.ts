import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { WorkspaceSnapshotEntry, WorkspaceSnapshotManifest, WorkspaceTransferLimits } from '../src/architecture/contracts.js'
import { canonicalWorkspacePath, validateWorkspaceSnapshotManifest, validateWorkspaceTransferLimits, workspaceManifestSha256 } from '../src/bundles/app-core/workspace-transfer.js'

const limits: WorkspaceTransferLimits = { maxFiles: 10, maxFileBytes: 1_024, maxTotalBytes: 4_096, chunkBytes: 256 }
const contentHash = createHash('sha256').update('hello').digest('hex')
function manifest(): WorkspaceSnapshotManifest {
  const base = {
    formatVersion: 1 as const, snapshotId: 'snapshot-1', projectId: 'project-1', taskId: 'task-1',
    entries: [
      { path: 'src', kind: 'directory' as const, sizeBytes: 0 },
      { path: 'src/index.ts', kind: 'file' as const, sizeBytes: 5, sha256: contentHash },
    ],
    totalBytes: 5,
  }
  return { ...base, manifestSha256: workspaceManifestSha256(base), createdAt: '2026-11-21T00:00:00.000Z' }
}

describe('workspace transfer validation', () => {
  it('accepts canonical relative paths and rejects traversal and ambiguous paths', () => {
    expect(canonicalWorkspacePath('src/index.ts')).toBe('src/index.ts')
    for (const path of ['', '../secret', 'src/../secret', '/etc/passwd', 'C:/secret', 'src\\secret', 'src//file', 'src/./file', 'CON', 'src/name.', 'src/name ', 'src/a:b', 'src/é'.normalize('NFD')]) {
      expect(canonicalWorkspacePath(path)).toBeUndefined()
    }
  })
  it('requires positive safe limits and bounded chunks', () => {
    expect(() => validateWorkspaceTransferLimits(limits)).not.toThrow()
    expect(() => validateWorkspaceTransferLimits({ ...limits, chunkBytes: 0 })).toThrow(/positive safe integer/)
    expect(() => validateWorkspaceTransferLimits({ ...limits, maxFileBytes: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/positive safe integer/)
    expect(() => validateWorkspaceTransferLimits({ ...limits, chunkBytes: 2_048 })).toThrow(/chunkBytes exceeds/)
    expect(() => validateWorkspaceTransferLimits({ ...limits, maxFileBytes: 8_192 })).toThrow(/maxFileBytes exceeds/)
  })
  it('accepts a sorted manifest with exact byte accounting and a valid digest', () => {
    expect(() => validateWorkspaceSnapshotManifest(manifest(), limits)).not.toThrow()
  })
  it('rejects traversal, unsorted entries, case collisions, and file-directory collisions', () => {
    const mutations: Array<(m: { entries: WorkspaceSnapshotEntry[] }) => void> = [
      (m) => { m.entries[1] = { ...m.entries[1]!, path: '../outside' } },
      (m) => { m.entries.reverse() },
      (m) => { m.entries.push({ path: 'SRC', kind: 'directory', sizeBytes: 0 }) },
      (m) => { m.entries.push({ path: 'src/index.ts/child', kind: 'directory', sizeBytes: 0 }) },
    ]
    for (const mutate of mutations) {
      const original = manifest()
      const candidate = { ...original, entries: [...original.entries] } as unknown as WorkspaceSnapshotManifest & { entries: WorkspaceSnapshotEntry[] }
      mutate(candidate)
      candidate.manifestSha256 = workspaceManifestSha256(candidate)
      expect(() => validateWorkspaceSnapshotManifest(candidate, limits)).toThrow()
    }
  })
  it('rejects digest, byte-total, file-size, and file-count mismatches', () => {
    const badHash = manifest()
    badHash.manifestSha256 = '0'.repeat(64)
    expect(() => validateWorkspaceSnapshotManifest(badHash, limits)).toThrow(/SHA-256 mismatch/)
    const badTotal = manifest()
    badTotal.totalBytes = 6
    badTotal.manifestSha256 = workspaceManifestSha256(badTotal)
    expect(() => validateWorkspaceSnapshotManifest(badTotal, limits)).toThrow(/totalBytes does not match/)
    const tooLargeBase = manifest()
    const tooLarge = { ...tooLargeBase, entries: [...tooLargeBase.entries] } as unknown as WorkspaceSnapshotManifest & { entries: WorkspaceSnapshotEntry[] }
    tooLarge.entries[1] = { ...tooLarge.entries[1]!, sizeBytes: 2_048 }
    tooLarge.totalBytes = 2_048
    tooLarge.manifestSha256 = workspaceManifestSha256(tooLarge)
    expect(() => validateWorkspaceSnapshotManifest(tooLarge, limits)).toThrow(/invalid file size/)
    expect(() => validateWorkspaceSnapshotManifest(manifest(), { ...limits, maxFiles: 1 })).toThrow(/file count/)
  })
})
