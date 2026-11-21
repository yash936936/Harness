import { createHash } from 'node:crypto'
import type { WorkspaceSnapshotManifest, WorkspaceSnapshotEntry, WorkspaceTransferLimits } from '../../architecture/contracts.js'

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

export function validateWorkspaceTransferLimits(limits: WorkspaceTransferLimits): void {
  if (!limits || typeof limits !== 'object') throw new TypeError('workspace transfer: limits are required')
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`workspace transfer: ${name} must be a positive safe integer`)
  }
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
  if (!Array.isArray(manifest.entries)) throw new TypeError('workspace transfer: manifest entries must be an array')
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
    const path = canonicalWorkspacePath(entry.path)
    if (!path || path !== entry.path) throw new TypeError('workspace transfer: manifest contains a non-canonical path')
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
    fileCount += 1
    if (fileCount > limits.maxFiles) throw new RangeError('workspace transfer: manifest file count exceeds its limit')
    if (entry.kind !== 'file' || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0 || entry.sizeBytes > limits.maxFileBytes) {
      throw new RangeError('workspace transfer: invalid file size')
    }
    if (typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) throw new TypeError('workspace transfer: file entries require a lowercase SHA-256 digest')
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
