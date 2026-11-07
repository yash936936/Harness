import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock } from '../../util/filelock.js'
import type { ConsentRecord, ConsentStore } from './types.js'

/** Does not survive restart. Default for tests and any run that doesn't need persistence. */
export class MemoryConsentStore implements ConsentStore {
  private records = new Map<string, ConsentRecord>()

  async get(projectId: string): Promise<ConsentRecord | undefined> {
    return this.records.get(projectId)
  }

  async set(record: ConsentRecord): Promise<void> {
    this.records.set(record.projectId, record)
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
    return all[projectId]
  }

  async set(record: ConsentRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    await withFileLock(`${this.path}.lock`, async () => {
      const all = await this.readAll()
      all[record.projectId] = record
      const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, `${JSON.stringify(all, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        await rename(temp, this.path)
      } finally {
        await rm(temp, { force: true }).catch(() => {})
      }
    })
  }

  private async readAll(): Promise<Record<string, ConsentRecord>> {
    try {
      const raw = await readFile(this.path, 'utf8')
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch (e: any) {
      if (e?.code === 'ENOENT') return {}
      throw e
    }
  }
}
