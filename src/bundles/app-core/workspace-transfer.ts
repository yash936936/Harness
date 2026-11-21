import { createHash } from 'node:crypto'
import type { WorkspaceSnapshotManifest, WorkspaceSnapshotEntry, WorkspaceTransferFile, WorkspaceTransferLimits } from '../../architecture/contracts.js'

const SHA256 = /^[a-f0-9]{64}$/
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const FORBIDDEN_SEGMENT = /[<>:"|?*\u0000-\u001f\u007f]/

/** Canonical project-relative path accepted by every transfer boundary. */
export function canonicalWorkspacePath(value: string): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return undefined
  if (value !== value.normalize('NFC') || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return undefined
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' ||
    segment.endsWith('.') || segment.endsWith(' ') || WINDOWS_RESERVED.test(segment) || FORBIDDEN_SEGMENT.test(segment))) return undefined
  return value
}

/** Reject common credential stores and private-key material from workspace transfer. */
export function isWorkspaceTransferPathAllowed(value: string): boolean {
  const canonical = canonicalWorkspacePath(value)
  if (!canonical) return false
  const segments = canonical.split('/').map((segment) => segment.toLocaleLowerCase('en-US'))
  const basename = segments[segments.length - 1]!
  if (segments.some((segment) => BLOCKED_DIRECTORIES.has(segment))) return false
  if (BLOCKED_FILES.has(basename) || PRIVATE_KEY_EXTENSION.test(basename)) return false
  if (basename === '.env' || basename.startsWith('.env.')) return false
  return true
}

export function validateWorkspaceTransferLimits(limits: WorkspaceTransferLimits): void {
  if (!limits || typeof limits !== 'object') throw new TypeError('workspace transfer: limits are required')
  for (const name of ['maxFiles', 'maxEntries', 'maxFileBytes', 'maxTotalBytes', 'chunkBytes'] as const) {
    const value = limits[name]
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`workspace transfer: ${name} must be a positive safe integer`)
  }
  if (limits.maxEntries < limits.maxFiles) throw new RangeError('workspace transfer: maxEntries must be at least maxFiles')
  if (limits.chunkBytes > limits.maxFileBytes || limits.chunkBytes > limits.maxTotalBytes) {
    throw new RangeError('workspace transfer: chunkBytes exceeds the configured byte limits')
  }
  if (limits.maxFileBytes > limits.maxTotalBytes) throw new RangeError('workspace transfer: maxFileBytes exceeds maxTotalBytes')
}

function canonicalEntry(entry: WorkspaceSnapshotEntry): Record<string, string | number> {
  if (entry.kind === 'directory') return { path: entry.path, kind: 'directory', sizeBytes: 0, ...(entry.mode === undefined ? {} : { mode: entry.mode }) }
  return { path: entry.path, kind: 'file', sizeBytes: entry.sizeBytes, sha256: entry.sha256, ...(entry.mode === undefined ? {} : { mode: entry.mode }) }
}

export function workspaceManifestPayload(manifest: Pick<WorkspaceSnapshotManifest,
  'formatVersion' | 'snapshotId' | 'projectId' | 'taskId' | 'entries' | 'totalBytes'
>): string {
  return JSON.stringify({
    formatVersion: manifest.formatVersion,
    snapshotId: manifest.snapshotId,
    projectId: manifest.projectId,
    taskId: manifest.taskId,
    entries: manifest.entries.map(canonicalEntry),
    totalBytes: manifest.totalBytes,
  })
}

export function workspaceManifestSha256(manifest: Pick<WorkspaceSnapshotManifest,
  'formatVersion' | 'snapshotId' | 'projectId' | 'taskId' | 'entries' | 'totalBytes'
>): string {
  return createHash('sha256').update(workspaceManifestPayload(manifest), 'utf8').digest('hex')
}

/** Validate path safety, ordering, uniqueness, byte accounting, and manifest digest. */
export function validateWorkspaceSnapshotManifest(manifest: WorkspaceSnapshotManifest, limits: WorkspaceTransferLimits): void {
  validateWorkspaceTransferLimits(limits)
  if (!manifest || manifest.formatVersion !== 1) throw new TypeError('workspace transfer: unsupported manifest format')
  for (const [name, value] of Object.entries({ snapshotId: manifest.snapshotId, projectId: manifest.projectId, taskId: manifest.taskId })) {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) throw new TypeError(`workspace transfer: invalid ${name}`)
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length > limits.maxEntries) throw new RangeError('workspace transfer: manifest entry count exceeds its limit')
  if (!Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0 || manifest.totalBytes > limits.maxTotalBytes) {
    throw new RangeError('workspace transfer: manifest totalBytes exceeds its limit')
  }
  const createdAt = Date.parse(manifest.createdAt)
  if (!Number.isFinite(createdAt) || new Date(createdAt).toISOString() !== manifest.createdAt) {
    throw new TypeError('workspace transfer: createdAt must be a canonical ISO timestamp')
  }
  let totalBytes = 0
  let fileCount = 0
  let previousPath: string | undefined
  const seen = new Map<string, WorkspaceSnapshotEntry['kind']>()
  for (const entry of manifest.entries) {
    if (!entry || typeof entry !== 'object') throw new TypeError('workspace transfer: manifest entry must be an object')
    const path = canonicalWorkspacePath(entry.path)
    if (!path || path !== entry.path) throw new TypeError('workspace transfer: manifest contains a non-canonical path')
    if (!isWorkspaceTransferPathAllowed(path)) throw new TypeError('workspace transfer: manifest contains a blocked secret-bearing path')
    if (previousPath !== undefined && previousPath >= path) throw new TypeError('workspace transfer: manifest paths must be unique and lexicographically sorted')
    previousPath = path
    const folded = path.toLocaleLowerCase('en-US')
    if (seen.has(folded)) throw new TypeError('workspace transfer: case-insensitive path collision')
    seen.set(folded, entry.kind)
    if (entry.mode !== undefined && (!Number.isSafeInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777)) {
      throw new TypeError('workspace transfer: invalid file mode')
    }
    if (entry.kind === 'directory') {
      if (entry.sizeBytes !== 0) throw new TypeError('workspace transfer: directory entries must have zero size')
      continue
    }
    if (entry.kind !== 'file' || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0 || entry.sizeBytes > limits.maxFileBytes) {
      throw new RangeError('workspace transfer: invalid file size')
    }
    if (typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) throw new TypeError('workspace transfer: file entries require a lowercase SHA-256 digest')
    fileCount += 1
    if (fileCount > limits.maxFiles) throw new RangeError('workspace transfer: manifest file count exceeds its limit')
    totalBytes += entry.sizeBytes
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) throw new RangeError('workspace transfer: aggregate file size exceeds its limit')
  }
  for (const [path, kind] of seen) {
    if (kind !== 'file') continue
    for (const candidate of seen.keys()) {
      if (candidate.startsWith(path + '/')) throw new TypeError('workspace transfer: file path is also used as a directory')
    }
  }
  if (totalBytes !== manifest.totalBytes) throw new TypeError('workspace transfer: totalBytes does not match file entries')
  if (typeof manifest.manifestSha256 !== 'string' || !SHA256.test(manifest.manifestSha256) ||
      workspaceManifestSha256(manifest) !== manifest.manifestSha256) throw new TypeError('workspace transfer: manifest SHA-256 mismatch')
}

/** Stream-validate one file without buffering its contents in memory. */
export async function validateWorkspaceTransferFile(file: WorkspaceTransferFile, limits: WorkspaceTransferLimits): Promise<void> {
  validateWorkspaceTransferLimits(limits)
  if (!file || canonicalWorkspacePath(file.path) !== file.path) throw new TypeError('workspace transfer: file path is not canonical')
  if (!isWorkspaceTransferPathAllowed(file.path)) throw new TypeError('workspace transfer: file path is blocked by secret-path policy')
  if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || file.sizeBytes > limits.maxFileBytes) {
    throw new RangeError('workspace transfer: declared file size exceeds its limit')
  }
  if (typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)) throw new TypeError('workspace transfer: invalid file SHA-256')
  if (!file.chunks || typeof file.chunks[Symbol.asyncIterator] !== 'function') throw new TypeError('workspace transfer: chunks must be an async iterable')
  const digest = createHash('sha256')
  let offset = 0
  for await (const chunk of file.chunks) {
    if (!chunk || !Number.isSafeInteger(chunk.offset) || chunk.offset !== offset) {
      throw new TypeError('workspace transfer: chunks must have contiguous offsets')
    }
    if (!(chunk.bytes instanceof Uint8Array) || chunk.bytes.byteLength === 0 || chunk.bytes.byteLength > limits.chunkBytes) {
      throw new RangeError('workspace transfer: chunk size is empty or exceeds its limit')
    }
    offset += chunk.bytes.byteLength
    if (!Number.isSafeInteger(offset) || offset > file.sizeBytes || offset > limits.maxFileBytes) {
      throw new RangeError('workspace transfer: streamed bytes exceed the declared file size')
    }
    digest.update(chunk.bytes)
  }
  if (offset !== file.sizeBytes) throw new TypeError('workspace transfer: streamed byte count does not match the declared file size')
  if (digest.digest('hex') !== file.sha256) throw new TypeError('workspace transfer: streamed file SHA-256 mismatch')
}

/** Validate a file stream sequentially, enforcing path order and aggregate limits. */
export async function validateWorkspaceTransferFiles(
  files: AsyncIterable<WorkspaceTransferFile>,
  limits: WorkspaceTransferLimits,
): Promise<{ readonly fileCount: number; readonly totalBytes: number }> {
  validateWorkspaceTransferLimits(limits)
  if (!files || typeof files[Symbol.asyncIterator] !== 'function') throw new TypeError('workspace transfer: files must be an async iterable')
  let fileCount = 0
  let totalBytes = 0
  let previousPath: string | undefined
  const seenPaths = new Set<string>()
  for await (const file of files) {
    fileCount += 1
    if (fileCount > limits.maxFiles) throw new RangeError('workspace transfer: file count exceeds its limit')
    const path = canonicalWorkspacePath(file.path)
    if (!path || path !== file.path) throw new TypeError('workspace transfer: file path is not canonical')
    if (!isWorkspaceTransferPathAllowed(path)) throw new TypeError('workspace transfer: file path is blocked by secret-path policy')
    if (previousPath !== undefined && previousPath >= path) {
      throw new TypeError('workspace transfer: file paths must be unique and lexicographically sorted')
    }
    const foldedPath = path.toLocaleLowerCase('en-US')
    if (seenPaths.has(foldedPath)) throw new TypeError('workspace transfer: case-insensitive file path collision')
    const segments = foldedPath.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      if (seenPaths.has(segments.slice(0, index).join('/'))) {
        throw new TypeError('workspace transfer: file path is also used as a directory')
      }
    }
    for (const existing of seenPaths) {
      if (existing.startsWith(foldedPath + '/')) {
        throw new TypeError('workspace transfer: file path is also used as a directory')
      }
    }
    previousPath = path
    seenPaths.add(foldedPath)
    await validateWorkspaceTransferFile(file, limits)
    totalBytes += file.sizeBytes
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
      throw new RangeError('workspace transfer: aggregate streamed bytes exceed their limit')
    }
  }
  return { fileCount, totalBytes }
}

/** Require the streamed file set to match the manifest exactly, including size and digest. */
export async function validateWorkspaceSnapshotFiles(
  files: AsyncIterable<WorkspaceTransferFile>,
  manifest: WorkspaceSnapshotManifest,
  limits: WorkspaceTransferLimits,
): Promise<{ readonly fileCount: number; readonly totalBytes: number }> {
  validateWorkspaceSnapshotManifest(manifest, limits)
  if (!files || typeof files[Symbol.asyncIterator] !== 'function') throw new TypeError('workspace transfer: files must be an async iterable')
  const expected = manifest.entries.filter((entry): entry is Extract<WorkspaceSnapshotEntry, { readonly kind: 'file' }> => entry.kind === 'file')
  let fileCount = 0
  let totalBytes = 0
  for await (const file of files) {
    const entry = expected[fileCount]
    if (!entry || file.path !== entry.path || file.sizeBytes !== entry.sizeBytes || file.sha256 !== entry.sha256) {
      throw new TypeError('workspace transfer: streamed files do not match the snapshot manifest')
    }
    await validateWorkspaceTransferFile(file, limits)
    fileCount += 1
    totalBytes += file.sizeBytes
  }
  if (fileCount !== expected.length || totalBytes !== manifest.totalBytes) {
    throw new TypeError('workspace transfer: streamed file set is incomplete')
  }
  return { fileCount, totalBytes }
}
