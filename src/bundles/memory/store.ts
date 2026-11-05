import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { withFileLock } from '../../util/filelock.js'
import { join } from 'node:path'
import type { Episode, EpisodeStore } from './types.js'

export class MemoryEpisodeStore implements EpisodeStore {
  private items = new Map<string, Episode>()
  async add(e: Episode) {
    if (this.items.has(e.id)) return false
    this.items.set(e.id, structuredClone(e))
    return true
  }
  async all() {
    return structuredClone([...this.items.values()])
  }
}

/** One JSONL file, `<dir>/episodic.jsonl`. Append-only, like the session log. */
export class JsonlEpisodeStore implements EpisodeStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private dir: string) {}

  private get file() {
    return join(this.dir, 'episodic.jsonl')
  }

  async add(e: Episode): Promise<boolean> {
    // Serialised so two concurrent writes of the same turn cannot both pass the duplicate check.
    // BUG-09: and across PROCESSES: under a file lock the ids are re-read from the file, so two processes cannot both add the same turn.
    const job = this.queue.then(async () => {
      await mkdir(this.dir, { recursive: true })
      return withFileLock(`${this.file}.lock`, async () => {
        const ids = new Set((await this.all()).map((x) => x.id))
        if (ids.has(e.id)) return false
        await appendFile(this.file, JSON.stringify(e) + '\n', 'utf8')
        return true
      })
    })
    this.queue = job.catch(() => {})
    return job
  }

  async all(): Promise<Episode[]> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (err: any) {
      if (err?.code === 'ENOENT') return []
      throw err
    }
    const lines = text.split('\n')
    const out: Episode[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line))
      } catch {
        // A torn final line (crash mid-write) is tolerated; corruption elsewhere is not.
        if (lines.slice(i + 1).some((l) => l.trim())) throw new Error(`memory: corrupt episodic.jsonl at line ${i + 1}`)
      }
    }
    return out
  }
}
