import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { WorkspaceSnapshotEntry, WorkspaceSnapshotManifest, WorkspaceTransferFile, WorkspaceTransferLimits } from '../src/architecture/contracts.js'
import { canonicalWorkspacePath, validateWorkspaceSnapshotManifest, validateWorkspaceTransferFile, validateWorkspaceTransferFiles, validateWorkspaceTransferLimits, validateWorkspaceSnapshotFiles, workspaceManifestSha256 } from '../src/bundles/app-core/workspace-transfer.js'

const limits: WorkspaceTransferLimits = { maxFiles: 10, maxEntries: 20, maxFileBytes: 1_024, maxTotalBytes: 4_096, chunkBytes: 256 }
const contentHash = createHash('sha256').update('hello').digest('hex')
type MutableManifest = { -readonly [K in keyof WorkspaceSnapshotManifest]: K extends 'entries' ? WorkspaceSnapshotEntry[] : WorkspaceSnapshotManifest[K] }
function manifest(): WorkspaceSnapshotManifest {
  const base = {
    formatVersion: 1 as const, snapshotId: 'snapshot-1', projectId: 'project-1', taskId: 'task-1',
    entries: [
      { path: 'src', kind: 'directory' as const, sizeBytes: 0 as const },
      { path: 'src/index.ts', kind: 'file' as const, sizeBytes: 5, sha256: contentHash },
    ],
    totalBytes: 5,
  }
  return { ...base, manifestSha256: workspaceManifestSha256(base), createdAt: '2026-11-21T00:00:00.000Z' }
}
function mutableManifest(): MutableManifest {
  const original = manifest()
  return { ...original, entries: [...original.entries] } as unknown as MutableManifest
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
    expect(() => validateWorkspaceTransferLimits({} as WorkspaceTransferLimits)).toThrow(/maxFiles must be a positive safe integer/)
    expect(() => validateWorkspaceTransferLimits({ ...limits, maxEntries: 9 })).toThrow(/maxEntries must be at least maxFiles/)
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
      (m) => { m.entries[0] = { path: '../outside', kind: 'directory', sizeBytes: 0 } },
      (m) => { m.entries.reverse() },
      (m) => { m.entries[0] = { path: 'SRC', kind: 'directory', sizeBytes: 0 }; m.entries[1] = { path: 'src', kind: 'directory', sizeBytes: 0 } },
      (m) => { m.entries.push({ path: 'src/index.ts/child', kind: 'directory', sizeBytes: 0 }) },
    ]
    for (const mutate of mutations) {
      const original = manifest()
      const candidate = { ...original, entries: [...original.entries] } as unknown as MutableManifest
      mutate(candidate)
      candidate.manifestSha256 = workspaceManifestSha256(candidate)
      expect(() => validateWorkspaceSnapshotManifest(candidate, limits)).toThrow()
    }
  })
  it('rejects digest, byte-total, file-size, and file-count mismatches', () => {
    const badHash = mutableManifest()
    badHash.manifestSha256 = '0'.repeat(64)
    expect(() => validateWorkspaceSnapshotManifest(badHash, limits)).toThrow(/SHA-256 mismatch/)
    const badTotal = mutableManifest()
    badTotal.totalBytes = 6
    badTotal.manifestSha256 = workspaceManifestSha256(badTotal)
    expect(() => validateWorkspaceSnapshotManifest(badTotal, limits)).toThrow(/totalBytes does not match/)
    const tooLarge = mutableManifest()
    tooLarge.entries[1] = { path: 'src/index.ts', kind: 'file', sizeBytes: 2_048, sha256: contentHash }
    tooLarge.totalBytes = 2_048
    tooLarge.manifestSha256 = workspaceManifestSha256(tooLarge)
    expect(() => validateWorkspaceSnapshotManifest(tooLarge, limits)).toThrow(/invalid file size/)
    const withSecondFileBase = manifest()
    const withSecondFile = { ...withSecondFileBase, entries: [...withSecondFileBase.entries, { path: 'z.ts', kind: 'file' as const, sizeBytes: 1, sha256: contentHash }], totalBytes: 6 }
    const secondFileManifest = { ...withSecondFile, manifestSha256: workspaceManifestSha256(withSecondFile) }
    expect(() => validateWorkspaceSnapshotManifest(secondFileManifest, { ...limits, maxFiles: 1 })).toThrow(/file count/)
    expect(() => validateWorkspaceSnapshotManifest(manifest(), { ...limits, maxFiles: 1 })).not.toThrow()
    expect(() => validateWorkspaceSnapshotManifest(manifest(), { ...limits, maxEntries: 1 })).toThrow(/entry count/)
  })
})

describe('workspace byte stream validation', () => {
  async function* chunks(parts: Uint8Array[]) {
    let offset = 0
    for (const bytes of parts) {
      yield { offset, bytes }
      offset += bytes.byteLength
    }
  }
  function file(path: string, value: string, chunkBytes = 256) {
    const bytes = new TextEncoder().encode(value)
    const parts = Array.from({ length: Math.ceil(bytes.byteLength / chunkBytes) }, (_, i) => bytes.slice(i * chunkBytes, (i + 1) * chunkBytes))
    return {
      path,
      sizeBytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      chunks: chunks(parts),
    }
  }
  it('validates file content incrementally and accepts empty files', async () => {
    await expect(validateWorkspaceTransferFile(file('a.txt', 'hello'), limits)).resolves.toBeUndefined()
    await expect(validateWorkspaceTransferFile(file('empty.txt', ''), limits)).resolves.toBeUndefined()
  })
  it('rejects non-contiguous offsets, oversized chunks, truncation, and digest mismatch', async () => {
    const valid = file('a.txt', 'hello')
    await expect(validateWorkspaceTransferFile({ ...valid, chunks: (async function* () { yield { offset: 1, bytes: new TextEncoder().encode('hello') } })() }, limits)).rejects.toThrow(/contiguous offsets/)
    await expect(validateWorkspaceTransferFile({ ...valid, chunks: (async function* () { yield { offset: 0, bytes: new Uint8Array(257) } })() }, limits)).rejects.toThrow(/chunk size/)
    await expect(validateWorkspaceTransferFile({ ...valid, chunks: (async function* () { yield { offset: 0, bytes: new TextEncoder().encode('he') } })() }, limits)).rejects.toThrow(/byte count/)
    await expect(validateWorkspaceTransferFile({ ...valid, sha256: '0'.repeat(64) }, limits)).rejects.toThrow(/SHA-256 mismatch/)
  })
  it('validates a sorted multi-file stream and enforces count and aggregate limits', async () => {
    const files = [file('a.txt', 'hello'), file('b.txt', 'world')]
    await expect(validateWorkspaceTransferFiles(chunksAsFiles(files), limits)).resolves.toEqual({ fileCount: 2, totalBytes: 10 })
    await expect(validateWorkspaceTransferFiles(chunksAsFiles(files), { ...limits, maxFiles: 1 })).rejects.toThrow(/file count/)
    await expect(validateWorkspaceTransferFiles(chunksAsFiles(files), { ...limits, maxTotalBytes: 8, maxFileBytes: 8, chunkBytes: 8 })).rejects.toThrow(/aggregate streamed bytes/)
  })
  it('rejects duplicate, case-folded, unsorted, and file-directory-colliding paths', async () => {
    await expect(validateWorkspaceTransferFiles(chunksAsFiles([file('b.txt', 'b'), file('a.txt', 'a')]), limits)).rejects.toThrow(/sorted/)
    await expect(validateWorkspaceTransferFiles(chunksAsFiles([file('a.txt', 'a'), file('a.txt', 'b')]), limits)).rejects.toThrow(/sorted/)
    await expect(validateWorkspaceTransferFiles(chunksAsFiles([file('A.txt', 'a'), file('a.txt', 'b')]), limits)).rejects.toThrow(/case-insensitive/)
    await expect(validateWorkspaceTransferFiles(chunksAsFiles([file('a', 'a'), file('a/child', 'b')]), limits)).rejects.toThrow(/file path is also used as a directory/)
  })
})
async function* chunksAsFiles(files: WorkspaceTransferFile[]) {
  for (const entry of files) yield entry
}

describe('workspace snapshot file-set validation', () => {
  async function* chunks(bytes: Uint8Array) {
    if (bytes.byteLength) yield { offset: 0, bytes }
  }
  function makeFile(path: string, content: string): WorkspaceTransferFile {
    const bytes = new TextEncoder().encode(content)
    return { path, sizeBytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), chunks: chunks(bytes) }
  }
  async function* files(entries: WorkspaceTransferFile[]) {
    for (const entry of entries) yield entry
  }
  it('requires exact manifest paths, sizes, hashes, and complete byte coverage', async () => {
    const snapshot = manifest()
    await expect(validateWorkspaceSnapshotFiles(files([makeFile('src/index.ts', 'hello')]), snapshot, limits)).resolves.toEqual({ fileCount: 1, totalBytes: 5 })
    await expect(validateWorkspaceSnapshotFiles(files([]), snapshot, limits)).rejects.toThrow(/incomplete/)
    await expect(validateWorkspaceSnapshotFiles(files([makeFile('src/other.ts', 'hello')]), snapshot, limits)).rejects.toThrow(/do not match/)
    await expect(validateWorkspaceSnapshotFiles(files([makeFile('src/index.ts', 'wrong')]), snapshot, limits)).rejects.toThrow(/do not match/)
  })
})
