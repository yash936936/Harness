import { mkdir } from 'node:fs/promises'
import { appendTextFileNoFollow, assertNoSymlinkParents, readTextLinesNoFollow, truncateFileNoFollow } from '../../util/secure-file.js'
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

  async *iterate(): AsyncGenerator<Episode> {
    for (const episode of this.items.values()) yield structuredClone(episode)
  }

  async findById(id: string): Promise<Episode | undefined> {
    const episode = this.items.get(id)
    return episode ? structuredClone(episode) : undefined
  }

  async count(): Promise<number> {
    return this.items.size
  }

  async all() {
    const out: Episode[] = []
    for await (const episode of this.iterate()) out.push(episode)
    return out
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
    const episode = structuredClone(e)
    const job = this.queue.then(async () => {
      await assertNoSymlinkParents(this.file)
      await mkdir(this.dir, { recursive: true })
      await assertNoSymlinkParents(this.file)
      return withFileLock(`${this.file}.lock`, async () => {
        if (await this.repairTailAndHasId(episode.id)) return false
        await appendTextFileNoFollow(this.file, JSON.stringify(episode) + '\\n')
        return true
      })
    })
    this.queue = job.catch(() => {})
    return job
  }

  /** Repair the final record and detect duplicates in one bounded-memory pass. */
  private async repairTailAndHasId(id: string): Promise<boolean> {
    let pending: { line: string; newline: boolean; start: number } | undefined
    let offset = 0
    let lineNumber = 0
    let found = false
    let sawRecord = false
    try {
      for await (const item of readTextLinesNoFollow(this.file)) {
        if (pending) {
          lineNumber++
          if (pending.line.trim()) {
            let parsed: Episode
            try {
              parsed = JSON.parse(pending.line) as Episode
            } catch {
              throw new Error(`memory: corrupt episodic.jsonl at line ${lineNumber}`)
            }
            sawRecord = true
            if (parsed.id === id) found = true
          }
          offset += Buffer.byteLength(pending.line, 'utf8') + (pending.newline ? 1 : 0)
        }
        pending = { ...item, start: offset }
      }
    } catch (error: any) {
      if (error?.code === 'ENOENT') return false
      throw error
    }

    if (pending) {
      lineNumber++
      if (pending.line.trim()) {
        try {
          const parsed = JSON.parse(pending.line) as Episode
          sawRecord = true
          if (parsed.id === id) found = true
        } catch {
          await truncateFileNoFollow(this.file, pending.start)
          return found
        }
      }
      if (!pending.newline && sawRecord) await appendTextFileNoFollow(this.file, '\\n')
    }
    return found
  }

  /** Stream valid records; tolerate only a malformed final record. */
  async *iterate(): AsyncGenerator<Episode> {
    let pending: string | undefined
    let lineNumber = 0
    try {
      for await (const item of readTextLinesNoFollow(this.file)) {
        if (pending !== undefined) {
          lineNumber++
          if (pending.trim()) {
            try {
              yield JSON.parse(pending) as Episode
            } catch {
              throw new Error(`memory: corrupt episodic.jsonl at line ${lineNumber}`)
            }
          }
        }
        pending = item.line
      }
    } catch (error: any) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    if (pending !== undefined && pending.trim()) {
      lineNumber++
      try {
        yield JSON.parse(pending) as Episode
      } catch {
        // An interrupted final write is ignored; the next add() repairs it.
      }
    }
  }

  async findById(id: string): Promise<Episode | undefined> {
    let found: Episode | undefined
    for await (const episode of this.iterate()) if (episode.id === id) found = episode
    return found ? structuredClone(found) : undefined
  }

  async count(): Promise<number> {
    let count = 0
    for await (const _episode of this.iterate()) count++
    return count
  }

  async all(): Promise<Episode[]> {
    const out: Episode[] = []
    for await (const episode of this.iterate()) out.push(episode)
    return out
  }
}
