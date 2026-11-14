import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { assertNoSymlinkParents } from '../../util/secure-file.js'
import { withFileLock } from '../../util/filelock.js'
import type { ConsentRecord, ConsentStore } from './types.js'

/** Does not survive restart. Default for tests and any run that doesn't need persistence. */
export class MemoryConsentStore implements ConsentStore {
  private records = new Map<string, ConsentRecord>()

  async get(projectId: string): Promise<ConsentRecord | undefined> {
    const record = this.records.get(projectId)
    return record ? { ...record } : undefined
  }

  async set(record: ConsentRecord): Promise<void> {
    if (!record || typeof record.projectId !== 'string' || !record.projectId.trim() || typeof record.consented !== 'boolean' || typeof record.decidedAt !== 'string') throw new Error('egress: invalid consent record')
    this.records.set(record.projectId, { ...record })
  }
}

/**
 * One JSON file holding every project's consent record, keyed by project id.
 * Updates are locked across processes and published with an atomic rename so
 * simultaneous project decisions cannot overwrite each other or expose partial JSON.
 */
export class FileConsentStore implements ConsentStore {
  constructor(private readonly path: string) {}

  async get(projectId: string): Promise<ConsentRecord | undefined> {
    const all = await this.readAll()
    const record = Object.hasOwn(all, projectId) ? all[projectId] : undefined
    return record ? { ...record } : undefined
  }

  async set(record: ConsentRecord): Promise<void> {
    if (!record || typeof record.projectId !== 'string' || !record.projectId.trim() || typeof record.consented !== 'boolean' || typeof record.decidedAt !== 'string') throw new Error('egress: invalid consent record')
    const safeRecord = { ...record }
    await assertNoSymlinkParents(this.path)
    await mkdir(dirname(this.path), { recursive: true })
    await assertNoSymlinkParents(this.path)
    await withFileLock(`${this.path}.lock`, async () => {
      const all = await this.readAll()
      all[safeRecord.projectId] = safeRecord
      const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, `${JSON.stringify(all, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        await assertNoSymlinkParents(this.path)
        await rename(temp, this.path)
      } finally {
        await rm(temp, { force: true }).catch(() => {})
      }
    })
  }

  private async readAll(): Promise<Record<string, ConsentRecord>> {
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      await assertNoSymlinkParents(this.path)
      const before = await lstat(this.path)
      if (before.isSymbolicLink() || !before.isFile()) throw new Error('egress: consent store must be a regular non-symlink file')
      handle = await open(this.path, fsConstants.O_RDONLY | (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0))
      const opened = await handle.stat()
      const after = await lstat(this.path)
      if (after.isSymbolicLink() || !after.isFile() || (process.platform !== 'win32' && (after.dev !== opened.dev || after.ino !== opened.ino))) {
        throw new Error('egress: consent store changed while opening; refusing to read it')
      }
      await assertNoSymlinkParents(this.path)
      const raw = await handle.readFile({ encoding: 'utf8' })
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('egress: consent store must contain a JSON object keyed by project id')
      }
      // A null-prototype map prevents project ids such as "__proto__" from
      // mutating the map's prototype or exposing inherited properties as consent.
      const records = Object.create(null) as Record<string, ConsentRecord>
      for (const [key, value] of Object.entries(parsed)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(`egress: invalid consent record for project "${key}"`)
        }
        const record = value as Partial<ConsentRecord>
        if (record.projectId !== key || typeof record.consented !== 'boolean' || typeof record.decidedAt !== 'string') {
          throw new Error(`egress: invalid consent record for project "${key}"`)
        }
        records[key] = record as ConsentRecord
      }
      return records
    } catch (e: any) {
      if (e?.code === 'ENOENT') return Object.create(null) as Record<string, ConsentRecord>
      throw e
    } finally {
      await handle?.close().catch(() => {})
    }
  }
}
