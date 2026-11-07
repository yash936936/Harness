import { appendFile, mkdir, readFile, truncate } from 'node:fs/promises'
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
    // Snapshot at the API boundary; this write may wait behind a queue or file lock.
    const episode = structuredClone(e)
    // Serialised so two concurrent writes of the same turn cannot both pass the duplicate check.
    // BUG-09: and across PROCESSES: under a file lock the ids are re-read from the file, so two processes cannot both add the same turn.
    const job = this.queue.then(async () => {
      await mkdir(this.dir, { recursive: true })
      return withFileLock(`${this.file}.lock`, async () => {
        await this.repairTail()
        const ids = new Set((await this.all()).map((x) => x.id))
        if (ids.has(episode.id)) return false
        await appendFile(this.file, JSON.stringify(episode) + '\n', 'utf8')
        return true
      })
    })
    this.queue = job.catch(() => {})
    return job
  }

  /** Repair only an incomplete final record while holding the store lock. */
  private async repairTail(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (err: any) {
      if (err?.code === 'ENOENT') return
      throw err
    }
    const lines = text.split('\n')
    let last = lines.length - 1
    while (last >= 0 && !lines[last]!.trim()) last--
    for (let i = 0; i <= last; i++) {
      try {
        JSON.parse(lines[i]!)
      } catch {
        if (i !== last) throw new Error(`memory: corrupt episodic.jsonl at line ${i + 1}`)
        // Only a torn final record is recoverable. Do not append past corruption
        // in the middle of the file, even when a later record is valid JSON.
        const end = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0)
        await truncate(this.file, end)
        return
      }
    }
    if (last >= 0 && !text.endsWith('\n')) await appendFile(this.file, '\n', 'utf8')
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
