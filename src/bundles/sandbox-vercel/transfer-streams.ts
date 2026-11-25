import { createHash } from 'node:crypto'
import type { WorkspaceTransferFile, WorkspaceTransferLimits } from '../../architecture/contracts.js'
import { canonicalWorkspacePath, isWorkspaceTransferPathAllowed, validateWorkspaceTransferLimits } from '../app-core/workspace-transfer.js'

export interface WorkspaceRemoteEntry {
  readonly path: string
  readonly kind: 'file' | 'directory'
  readonly sizeBytes: number
  readonly mode: number
}

/**
 * Incrementally parses find -printf '%y\\0%s\\0%m\\0%P\\0' output.
 * Fields are NUL-delimited so filenames containing spaces, tabs, or newlines
 * cannot corrupt the record boundaries. The caller must invoke finish().
 */
export class WorkspaceFindRecordParser {
  private field = ''
  private fields: string[] = []
  private previousPath?: string
  private readonly seenPaths = new Map<string, 'file' | 'directory'>()
  private readonly pathSpellings = new Map<string, string>()

  constructor(private readonly maxEntries: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100_000) {
      throw new RangeError('workspace transfer: maxEntries must be a positive safe integer')
    }
  }

  push(chunk: string, emit: (entry: WorkspaceRemoteEntry) => void): void {
    if (typeof chunk !== 'string') throw new TypeError('workspace transfer: find output chunk must be text')
    for (let index = 0; index < chunk.length; index += 1) {
      const char = chunk[index]!
      if (char === '\0') {
        this.fields.push(this.field)
        this.field = ''
        if (this.fields.length === 4) {
          const [kind, sizeText, modeText, path] = this.fields
          this.fields = []
          if (kind !== 'f' && kind !== 'd') {
            throw new TypeError('workspace transfer: symlinks and special files are not transferable')
          }
          if (!/^(0|[1-9][0-9]*)$/.test(sizeText!) || !Number.isSafeInteger(Number(sizeText)) ||
              (kind === 'd' && sizeText !== '0')) {
            throw new TypeError('workspace transfer: invalid remote file size')
          }
          if (!/^[0-7]{3,4}$/.test(modeText!) || Number.parseInt(modeText!, 8) > 0o777) {
            throw new TypeError('workspace transfer: invalid or privileged remote file mode')
          }
          if (!path || path.length > 1_024 || canonicalWorkspacePath(path) !== path ||
              !isWorkspaceTransferPathAllowed(path)) {
            throw new TypeError('workspace transfer: remote path is not allowed')
          }
          if (this.previousPath !== undefined && this.previousPath >= path) {
            throw new TypeError('workspace transfer: remote paths are not unique and lexicographically sorted')
          }
          const segments = path.split('/')
          let foldedPrefix = ''
          let originalPrefix = ''
          for (let index = 0; index < segments.length; index += 1) {
            foldedPrefix = foldedPrefix ? `${foldedPrefix}/${segments[index]!.toLocaleLowerCase('en-US')}` : segments[index]!.toLocaleLowerCase('en-US')
            originalPrefix = originalPrefix ? `${originalPrefix}/${segments[index]}` : segments[index]!
            const previousSpelling = this.pathSpellings.get(foldedPrefix)
            if (previousSpelling !== undefined && previousSpelling !== originalPrefix) {
              throw new TypeError('workspace transfer: remote paths contain a case-insensitive collision')
            }
            this.pathSpellings.set(foldedPrefix, originalPrefix)
            if (index < segments.length - 1 && this.seenPaths.get(foldedPrefix) === 'file') {
              throw new TypeError('workspace transfer: a remote file path is also used as a directory')
            }
          }
          const folded = path.toLocaleLowerCase('en-US')
          if (this.seenPaths.has(folded)) {
            throw new TypeError('workspace transfer: remote paths contain a case-insensitive collision')
          }
          this.previousPath = path
          this.seenPaths.set(folded, kind === 'f' ? 'file' : 'directory')
          this.entryCount += 1
          if (this.entryCount > this.maxEntries) {
            throw new RangeError('workspace transfer: remote entry count exceeds its limit')
          }
          const entry: WorkspaceRemoteEntry = {
            path,
            kind: kind === 'f' ? 'file' : 'directory',
            sizeBytes: kind === 'd' ? 0 : Number(sizeText),
            mode: Number.parseInt(modeText!, 8),
          }
          emit(entry)
        }
      } else {
        this.field += char
        const fieldLimit = this.fields.length === 0 ? 1 : this.fields.length === 1 ? 20 : this.fields.length === 2 ? 4 : 1_024
        if (this.field.length > fieldLimit) throw new RangeError('workspace transfer: remote metadata field exceeds its limit')
      }
    }
  }

  private entryCount = 0

  finish(): void {
    if (this.field.length !== 0 || this.fields.length !== 0) {
      throw new TypeError('workspace transfer: remote enumeration ended with a truncated record')
    }
  }
}

/**
 * Decodes base64 log output into bounded byte chunks without retaining the
 * complete encoded file or complete decoded file in memory.
 */
export class BoundedBase64Decoder {
  private pending = ''
  private totalBytes = 0

  constructor(
    private readonly chunkBytes: number,
    private readonly maxBytes: number,
  ) {
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 3 || chunkBytes > 1_048_576 ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 536_870_912) {
      throw new RangeError('workspace transfer: invalid base64 decoder limits')
    }
  }

  push(encoded: string, emit: (bytes: Uint8Array) => void): void {
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/=]*$/.test(encoded)) {
      throw new TypeError('workspace transfer: remote base64 output contains invalid characters')
    }
    let offset = 0
    const maxEncoded = Math.floor(this.chunkBytes / 3) * 4
    while (offset < encoded.length) {
      const take = Math.min(maxEncoded, encoded.length - offset)
      this.pending += encoded.slice(offset, offset + take)
      offset += take
      this.flushCompleteGroups(emit, false)
    }
  }

  finish(emit: (bytes: Uint8Array) => void): void {
    this.flushCompleteGroups(emit, true)
    if (this.pending.length !== 0) throw new TypeError('workspace transfer: remote base64 output is truncated')
  }

  private flushCompleteGroups(emit: (bytes: Uint8Array) => void, final: boolean): void {
    while (this.pending.length >= 4) {
      const maxEncoded = Math.floor(this.chunkBytes / 3) * 4
      const available = Math.max(0, this.pending.length - 4)
      const take = Math.min(available - (available % 4), maxEncoded)
      if (take <= 0) break
      const value = this.pending.slice(0, take)
      this.pending = this.pending.slice(take)
      if (value.includes('=')) throw new TypeError('workspace transfer: base64 padding appeared before end of stream')
      this.emitDecoded(value, emit)
    }
    if (final && this.pending.length > 0) {
      if (this.pending.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(this.pending)) {
        throw new TypeError(this.pending.length % 4 !== 0
          ? 'workspace transfer: remote base64 output is truncated'
          : 'workspace transfer: remote base64 output has invalid final padding')
      }
      const value = this.pending
      this.pending = ''
      this.emitDecoded(value, emit)
    }
  }

  private emitDecoded(encoded: string, emit: (bytes: Uint8Array) => void): void {
    const bytes = Buffer.from(encoded, 'base64')
    // Buffer's decoder is intentionally permissive. Require canonical base64 so
    // non-zero pad bits and alternate malformed encodings cannot pass silently.
    if (bytes.toString('base64') !== encoded) {
      throw new TypeError('workspace transfer: remote base64 output is not canonical')
    }
    if (bytes.byteLength > this.chunkBytes || this.totalBytes + bytes.byteLength > this.maxBytes) {
      throw new RangeError('workspace transfer: decoded bytes exceed the configured limit')
    }
    this.totalBytes += bytes.byteLength
    if (bytes.byteLength) emit(new Uint8Array(bytes))
  }

  get bytesDecoded(): number {
    return this.totalBytes
  }
}


/** Minimal Vercel command surface needed for bounded stdin uploads. */
export interface WorkspaceStdinCommand {
  writeStdin(data: Uint8Array): Promise<void>
  closeStdin(): Promise<void>
  wait(options?: { signal?: AbortSignal }): Promise<{ readonly exitCode: number | null }>
  kill(signal?: 'SIGHUP' | 'SIGINT' | 'SIGQUIT' | 'SIGKILL' | 'SIGTERM' | 'SIGCONT' | 'SIGSTOP' | number): Promise<void>
}

/**
 * Stream one validated workspace file into a remote staging command.
 *
 * The caller must create an exclusive staging target and remove it if this
 * function rejects. The stream is hashed while it is sent, so no file-sized
 * buffer is created on the host. A failed stream always attempts to terminate
 * the remote writer before returning.
 */
export async function writeWorkspaceTransferFileToStdin(
  file: WorkspaceTransferFile,
  command: WorkspaceStdinCommand,
  limits: WorkspaceTransferLimits,
  signal?: AbortSignal,
): Promise<void> {
  validateWorkspaceTransferLimits(limits)
  if (!file || canonicalWorkspacePath(file.path) !== file.path ||
      !isWorkspaceTransferPathAllowed(file.path)) {
    throw new TypeError('workspace transfer: upload path is not allowed')
  }
  if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || file.sizeBytes > limits.maxFileBytes) {
    throw new RangeError('workspace transfer: upload size exceeds its limit')
  }
  if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
    throw new TypeError('workspace transfer: upload SHA-256 is invalid')
  }
  if (!file.chunks || typeof file.chunks[Symbol.asyncIterator] !== 'function') {
    throw new TypeError('workspace transfer: upload chunks must be an async iterable')
  }

  const digest = createHash('sha256')
  let offset = 0
  let closed = false
  let settled = false
  try {
    for await (const chunk of file.chunks) {
      signal?.throwIfAborted()
      if (!chunk || !Number.isSafeInteger(chunk.offset) || chunk.offset !== offset) {
        throw new TypeError('workspace transfer: upload chunks must have contiguous offsets')
      }
      if (!(chunk.bytes instanceof Uint8Array) || chunk.bytes.byteLength === 0 ||
          chunk.bytes.byteLength > limits.chunkBytes) {
        throw new RangeError('workspace transfer: upload chunk is empty or exceeds its limit')
      }
      offset += chunk.bytes.byteLength
      if (!Number.isSafeInteger(offset) || offset > file.sizeBytes || offset > limits.maxFileBytes) {
        throw new RangeError('workspace transfer: upload exceeds its declared size')
      }
      digest.update(chunk.bytes)
      await command.writeStdin(chunk.bytes)
    }
    if (offset !== file.sizeBytes) {
      throw new TypeError('workspace transfer: uploaded byte count does not match its declaration')
    }
    if (digest.digest('hex') !== file.sha256) {
      throw new TypeError('workspace transfer: uploaded file SHA-256 mismatch')
    }
    signal?.throwIfAborted()
    await command.closeStdin()
    closed = true
    const result = await command.wait({ signal })
    settled = true
    if (result.exitCode !== 0) {
      throw new Error(`workspace transfer: remote staging writer exited with code ${String(result.exitCode)}`)
    }
  } catch (error) {
    if (!settled) {
      try { await command.kill('SIGTERM') } catch { /* best-effort termination before staging cleanup */ }
      if (!closed) {
        try { await command.closeStdin() } catch { /* command may already have exited */ }
      }
      try { await command.wait() } catch { /* preserve the original transfer failure */ }
    }
    throw error
  }
}
