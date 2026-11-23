import { describe, expect, it } from 'vitest'
import { enumerateWorkspaceTree, type VercelWorkspaceFileStat } from '../src/bundles/sandbox-vercel/workspace-filesystem.js'
import type { WorkspaceTransferLimits } from '../src/architecture/contracts.js'

const limits: WorkspaceTransferLimits = {
  maxFiles: 10,
  maxEntries: 20,
  maxFileBytes: 1_024,
  maxTotalBytes: 4_096,
  chunkBytes: 256,
}

function stat(kind: 'file' | 'directory' | 'symlink' | 'special', size = 0): VercelWorkspaceFileStat {
  return {
    size,
    mode: kind === 'directory' ? 0o40755 : 0o100644,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'directory',
    isSymbolicLink: () => kind === 'symlink',
  }
}

function filesystem(tree: Record<string, readonly string[]>, stats: Record<string, VercelWorkspaceFileStat>, realpaths: Record<string, string> = {}) {
  return {
    async realpath(path: string) { return realpaths[path] ?? path },
    async readdir(path: string) { return (tree[path] ?? []).map((name) => ({ name })) },
    async lstat(path: string) {
      const value = stats[path]
      if (!value) throw new Error(`missing fixture path: ${path}`)
      return value
    },
  }
}

describe('Vercel workspace filesystem enumeration', () => {
  it('returns sorted metadata and enforces file and aggregate quotas', async () => {
    const fs = filesystem(
      { '/home/harness/workspace': ['z.txt', 'src'], '/home/harness/workspace/src': ['a.ts'] },
      {
        '/home/harness/workspace/src': stat('directory'),
        '/home/harness/workspace/src/a.ts': stat('file', 3),
        '/home/harness/workspace/z.txt': stat('file', 5),
      },
    )
    const result = await enumerateWorkspaceTree(fs, '/home/harness/workspace', limits)
    expect(result).toEqual({
      entries: [
        { path: 'src', kind: 'directory', sizeBytes: 0, mode: 0o755 },
        { path: 'src/a.ts', kind: 'file', sizeBytes: 3, mode: 0o644 },
        { path: 'z.txt', kind: 'file', sizeBytes: 5, mode: 0o644 },
      ],
      fileCount: 2,
      totalBytes: 8,
    })
  })

  it('rejects symbolic links before traversing or reading them', async () => {
    const fs = filesystem(
      { '/home/harness/workspace': ['link'] },
      { '/home/harness/workspace/link': stat('symlink') },
    )
    await expect(enumerateWorkspaceTree(fs, '/home/harness/workspace', limits)).rejects.toThrow(/symbolic links/)
  })

  it('rejects special files and paths covered by secret policy', async () => {
    const special = filesystem(
      { '/home/harness/workspace': ['pipe'] },
      { '/home/harness/workspace/pipe': stat('special') },
    )
    await expect(enumerateWorkspaceTree(special, '/home/harness/workspace', limits)).rejects.toThrow(/special filesystem/)
    const secret = filesystem(
      { '/home/harness/workspace': ['.env'] },
      { '/home/harness/workspace/.env': stat('file', 1) },
    )
    await expect(enumerateWorkspaceTree(secret, '/home/harness/workspace', limits)).rejects.toThrow(/secret-bearing/)
  })

  it('rejects resolved paths outside the workspace root', async () => {
    const fs = filesystem(
      { '/home/harness/workspace': ['escape.txt'] },
      { '/home/harness/workspace/escape.txt': stat('file', 1) },
      { '/home/harness/workspace/escape.txt': '/etc/passwd' },
    )
    await expect(enumerateWorkspaceTree(fs, '/home/harness/workspace', limits)).rejects.toThrow(/outside the workspace/)
  })

  it('rejects per-file, aggregate, and entry-count quota violations', async () => {
    const tooLarge = filesystem(
      { '/home/harness/workspace': ['large.bin'] },
      { '/home/harness/workspace/large.bin': stat('file', 1_025) },
    )
    await expect(enumerateWorkspaceTree(tooLarge, '/home/harness/workspace', limits)).rejects.toThrow(/file size/)
    const tooMany = filesystem(
      { '/home/harness/workspace': ['a', 'b'] },
      { '/home/harness/workspace/a': stat('file', 1), '/home/harness/workspace/b': stat('file', 1) },
    )
    await expect(enumerateWorkspaceTree(tooMany, '/home/harness/workspace', { ...limits, maxFiles: 1 })).rejects.toThrow(/quota/)
  })

  it('honors cancellation during traversal', async () => {
    const controller = new AbortController()
    controller.abort()
    const fs = filesystem({ '/home/harness/workspace': ['file'] }, { '/home/harness/workspace/file': stat('file', 1) })
    await expect(enumerateWorkspaceTree(fs, '/home/harness/workspace', limits, controller.signal)).rejects.toThrow()
  })
})
