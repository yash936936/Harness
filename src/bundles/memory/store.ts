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
        await appendTextFileNoFollow(this.file, JSON.stringify(episode) + '\n')
        return true
      })
    })
    this.queue = job.catch(() => {})
    return job
  }

  /** Repair the final record and detect duplicates in one bounded-memory pass. */
  private async repairTailAndHasId(id: string): Promise<boolean> {
    let candidate: { line: string; start: number; lineNumber: number } | undefined
    let offset = 0
    let trailingBlankBytes = 0
    let endedWithNewline = true
    let physicalLine = 0
    let found = false
    try {
      for await (const item of readTextLinesNoFollow(this.file)) {
        physicalLine++
        endedWithNewline = item.newline
        const bytes = Buffer.byteLength(item.line, 'utf8') + (item.newline ? 1 : 0)
        if (!item.line.trim()) {
          trailingBlankBytes += bytes
          continue
        }
        if (candidate) {
          let parsed: Episode
          try {
            parsed = JSON.parse(candidate.line) as Episode
          } catch {
            throw new Error(`memory: corrupt episodic.jsonl at line ${candidate.lineNumber}`)
          }
          if (parsed.id === id) found = true
          offset = candidate.start + Buffer.byteLength(candidate.line, 'utf8') + 1 + trailingBlankBytes
        } else {
          offset += trailingBlankBytes
        }
        candidate = { line: item.line, start: offset, lineNumber: physicalLine }
        trailingBlankBytes = 0
      }
    } catch (error: any) {
      if (error?.code === 'ENOENT') return false
      throw error
    }

    if (candidate) {
      let parsed: Episode
      try {
        parsed = JSON.parse(candidate.line) as Episode
      } catch {
        await truncateFileNoFollow(this.file, candidate.start)
        return found
      }
      if (parsed.id === id) found = true
      if (!endedWithNewline) await appendTextFileNoFollow(this.file, '\n')
    }
    return found
  }

  /** Stream valid records; tolerate only a malformed final non-blank record. */
  async *iterate(): AsyncGenerator<Episode> {
    let candidate: { line: string; lineNumber: number } | undefined
    let physicalLine = 0
    try {
      for await (const item of readTextLinesNoFollow(this.file)) {
        physicalLine++
        if (!item.line.trim()) continue
        if (candidate) {
          try {
            yield JSON.parse(candidate.line) as Episode
          } catch {
            throw new Error(`memory: corrupt episodic.jsonl at line ${candidate.lineNumber}`)
          }
        }
        candidate = { line: item.line, lineNumber: physicalLine }
      }
    } catch (error: any) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    if (candidate) {
      try {
        yield JSON.parse(candidate.line) as Episode
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
