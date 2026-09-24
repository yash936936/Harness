import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
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
 * This is the "first-run consent record" 1B.1 asks for: it persists across
 * process restarts, so a project only has to decide once.
 */
export class FileConsentStore implements ConsentStore {
  constructor(private readonly path: string) {}

  async get(projectId: string): Promise<ConsentRecord | undefined> {
    const all = await this.readAll()
    return all[projectId]
  }

  async set(record: ConsentRecord): Promise<void> {
    const all = await this.readAll()
    all[record.projectId] = record
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, `${JSON.stringify(all, null, 2)}\n`, 'utf8')
  }

  private async readAll(): Promise<Record<string, ConsentRecord>> {
    try {
      const raw = await readFile(this.path, 'utf8')
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (e: any) {
      if (e?.code === 'ENOENT') return {}
      throw e
    }
  }
}
