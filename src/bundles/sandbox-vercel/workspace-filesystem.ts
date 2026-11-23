import { posix } from 'node:path'
import type { WorkspaceTransferLimits } from '../../architecture/contracts.js'
import { isWorkspaceTransferPathAllowed, validateWorkspaceTransferLimits } from '../app-core/workspace-transfer.js'

export interface VercelWorkspaceFileEntry {
  readonly name: string
}

export interface VercelWorkspaceFileStat {
  readonly size: number
  readonly mode: number
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

export interface VercelWorkspaceFileSystem {
  readdir(path: string, options: { withFileTypes: true; signal?: AbortSignal }): Promise<readonly VercelWorkspaceFileEntry[]>
  lstat(path: string, options?: { signal?: AbortSignal }): Promise<VercelWorkspaceFileStat>
  realpath(path: string, options?: { signal?: AbortSignal }): Promise<string>
}

export type WorkspaceTreeEntry =
  | { readonly path: string; readonly kind: 'directory'; readonly sizeBytes: 0; readonly mode: number }
  | { readonly path: string; readonly kind: 'file'; readonly sizeBytes: number; readonly mode: number }

export interface WorkspaceTreeEnumeration {
  readonly entries: readonly WorkspaceTreeEntry[]
  readonly fileCount: number
  readonly totalBytes: number
}

function inside(root: string, candidate: string): boolean {
  const relative = posix.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith('../') && !posix.isAbsolute(relative))
}

/**
 * Enumerate workspace metadata without following links or accepting special files.
 * File contents and hashes are deliberately not produced here. A separate bounded,
 * no-follow byte reader must revalidate file identity before every read.
 */
export async function enumerateWorkspaceTree(
  fs: VercelWorkspaceFileSystem,
  rootPath: string,
  limits: WorkspaceTransferLimits,
  signal?: AbortSignal,
): Promise<WorkspaceTreeEnumeration> {
  validateWorkspaceTransferLimits(limits)
  if (!fs || typeof rootPath !== 'string' || !rootPath.startsWith('/') || rootPath.includes('\\0')) {
    throw new TypeError('vercel-workspace: invalid filesystem root')
  }
  const root = await fs.realpath(rootPath, { signal })
  if (!posix.isAbsolute(root)) throw new Error('vercel-workspace: workspace root did not resolve to an absolute path')
  const entries: WorkspaceTreeEntry[] = []
  let fileCount = 0
  let totalBytes = 0

  const walk = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
    signal?.throwIfAborted()
    const children = await fs.readdir(absoluteDirectory, { withFileTypes: true, signal })
    const names = children.map((entry) => entry.name)
    if (names.some((name) => typeof name !== 'string' || !name || name === '.' || name === '..' || name.includes('/') || name.includes('\\\\') || name.includes('\\0'))) {
      throw new Error('vercel-workspace: provider returned an invalid directory entry')
    }
    names.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    for (const name of names) {
      signal?.throwIfAborted()
      const path = relativeDirectory ? `${relativeDirectory}/${name}` : name
      if (!isWorkspaceTransferPathAllowed(path)) {
        throw new Error('vercel-workspace: workspace contains a blocked secret-bearing path')
      }
      const absolute = posix.join(absoluteDirectory, name)
      const stat = await fs.lstat(absolute, { signal })
      if (stat.isSymbolicLink()) throw new Error('vercel-workspace: symbolic links are not transferable')
      const resolved = await fs.realpath(absolute, { signal })
      if (!inside(root, resolved)) throw new Error('vercel-workspace: filesystem entry resolves outside the workspace')
      if (stat.isDirectory()) {
        entries.push({ path, kind: 'directory', sizeBytes: 0, mode: stat.mode & 0o777 })
        if (entries.length > limits.maxEntries) throw new RangeError('vercel-workspace: workspace entry count exceeds its limit')
        await walk(absolute, path)
        continue
      }
      if (!stat.isFile()) throw new Error('vercel-workspace: special filesystem entries are not transferable')
      if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > limits.maxFileBytes) {
        throw new RangeError('vercel-workspace: workspace file size exceeds its limit')
      }
      fileCount += 1
      totalBytes += stat.size
      if (fileCount > limits.maxFiles || !Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
        throw new RangeError('vercel-workspace: workspace transfer quota exceeded')
      }
      entries.push({ path, kind: 'file', sizeBytes: stat.size, mode: stat.mode & 0o777 })
      if (entries.length > limits.maxEntries) throw new RangeError('vercel-workspace: workspace entry count exceeds its limit')
    }
  }

  await walk(root, '')
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return { entries, fileCount, totalBytes }
}
