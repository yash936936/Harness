import { mkdir, open, rename, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { appendTextFileNoFollow, assertNoSymlinkParents, readTextFileNoFollow, readTextLinesNoFollow, readTextRangeNoFollow, truncateFileNoFollow } from '../../util/secure-file.js'
import { withFileLock } from '../../util/filelock.js'
import { join } from 'node:path'
import { MemoryError, type Episode, type EpisodeStore } from './types.js'

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

interface EpisodeIndexEntry {
  id: string
  offset: number
  length: number
}
interface EpisodeIndexManifest {
  version: 1
  sourceBytes: number
  indexBytes: number
}

/** One append-only JSONL source plus a rebuildable, append-only identity index. */
export class JsonlEpisodeStore implements EpisodeStore {
  private queue: Promise<unknown> = Promise.resolve()
  private pendingWrites = 0
  private indexCache?: { sourceBytes: number; indexBytes: number; entries: Map<string, EpisodeIndexEntry> }

  constructor(private dir: string, private maxPendingWrites = 1024) {
    if (!Number.isSafeInteger(this.maxPendingWrites) || this.maxPendingWrites < 1) {
      throw new MemoryError('memory: maxPendingEpisodeWrites must be a positive safe integer')
    }
  }

  private get file() { return join(this.dir, 'episodic.jsonl') }
  private get indexFile() { return join(this.dir, 'episodic.index.jsonl') }
  private get manifestFile() { return join(this.dir, 'episodic.index.meta.json') }

  async add(e: Episode): Promise<boolean> {
    const episode = structuredClone(e)
    if (this.pendingWrites >= this.maxPendingWrites) {
      throw new MemoryError(`memory: episodic write queue is full (${this.pendingWrites}/${this.maxPendingWrites})`)
    }
    this.pendingWrites++
    const job = this.queue.then(async () => {
      await assertNoSymlinkParents(this.file)
      await mkdir(this.dir, { recursive: true })
      await assertNoSymlinkParents(this.file)
      return withFileLock(`${this.file}.lock`, async () => {
        let entries = await this.ensureIndex()
        const existing = entries.get(episode.id)
        if (existing) {
          try {
            const stored = JSON.parse(await readTextRangeNoFollow(this.file, existing.offset, existing.length)) as Episode
            if (stored.id === episode.id) return false
          } catch {
            // A sidecar entry that does not resolve to its claimed source record is stale.
          }
          this.indexCache = undefined
          entries = await this.rebuildIndex()
          const rebuilt = entries.get(episode.id)
          if (rebuilt) {
            const stored = JSON.parse(await readTextRangeNoFollow(this.file, rebuilt.offset, rebuilt.length)) as Episode
            if (stored.id === episode.id) return false
          }
        }
        const sourceBytes = await this.fileSize(this.file)
        const line = JSON.stringify(episode) + '\n'
        await appendTextFileNoFollow(this.file, line)
        const offset = sourceBytes
        const length = Buffer.byteLength(line, 'utf8') - 1
        const indexLine = JSON.stringify({ id: episode.id, offset, length }) + '\n'
        try {
          await appendTextFileNoFollow(this.indexFile, indexLine)
          const nextSourceBytes = sourceBytes + Buffer.byteLength(line, 'utf8')
          const nextIndexBytes = (await this.fileSize(this.indexFile))
          await this.writeManifest({ version: 1, sourceBytes: nextSourceBytes, indexBytes: nextIndexBytes })
          entries.set(episode.id, { id: episode.id, offset, length })
          this.indexCache = { sourceBytes: nextSourceBytes, indexBytes: nextIndexBytes, entries }
          return true
        } catch (error) {
          // The episode log is authoritative. A failed index update is rebuilt on the next operation.
          this.indexCache = undefined
          throw error
        }
      })
    })
    this.queue = job.catch(() => {})
    void job.then(() => { this.pendingWrites-- }, () => { this.pendingWrites-- })
    return job
  }

  private async fileSize(path: string): Promise<number> {
    try { return (await stat(path)).size }
    catch (error: any) { if (error?.code === 'ENOENT') return 0; throw error }
  }

  private async writeManifest(manifest: EpisodeIndexManifest): Promise<void> {
    const temporary = `${this.manifestFile}.${process.pid}.${randomUUID()}.tmp`
    await assertNoSymlinkParents(this.manifestFile)
    try {
      await writeFile(temporary, JSON.stringify(manifest), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await assertNoSymlinkParents(this.manifestFile)
      await rename(temporary, this.manifestFile)
    } catch (error) {
      const { unlink } = await import('node:fs/promises')
      await unlink(temporary).catch(() => {})
      throw error
    }
  }

  private async readManifest(): Promise<EpisodeIndexManifest | undefined> {
    try {
      const parsed = JSON.parse(await readTextFileNoFollow(this.manifestFile)) as Partial<EpisodeIndexManifest>
      if (parsed.version !== 1 || !Number.isSafeInteger(parsed.sourceBytes) || parsed.sourceBytes! < 0 ||
          !Number.isSafeInteger(parsed.indexBytes) || parsed.indexBytes! < 0) return undefined
      return parsed as EpisodeIndexManifest
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined
      return undefined
    }
  }

  /** Trust the index only when its manifest matches both files; otherwise rebuild from the authoritative episode log. */
  private async ensureIndex(): Promise<Map<string, EpisodeIndexEntry>> {
    const sourceBytes = await this.fileSize(this.file)
    const indexBytes = await this.fileSize(this.indexFile)
    if (this.indexCache?.sourceBytes === sourceBytes && this.indexCache.indexBytes === indexBytes) return this.indexCache.entries

    const manifest = await this.readManifest()
    if (manifest && manifest.sourceBytes === sourceBytes && manifest.indexBytes === indexBytes) {
      try {
        const entries = new Map<string, EpisodeIndexEntry>()
        for await (const item of readTextLinesNoFollow(this.indexFile)) {
          if (!item.line.trim()) continue
          const entry = JSON.parse(item.line) as EpisodeIndexEntry
          if (typeof entry.id !== 'string' || !entry.id || !Number.isSafeInteger(entry.offset) || entry.offset < 0 ||
              !Number.isSafeInteger(entry.length) || entry.length < 0) throw new Error('invalid identity index entry')
          entries.set(entry.id, entry)
        }
        this.indexCache = { sourceBytes, indexBytes, entries }
        return entries
      } catch {
        // Rebuild below from the authoritative episode log.
      }
    }
    return this.rebuildIndex()
  }

  private async rebuildIndex(): Promise<Map<string, EpisodeIndexEntry>> {
    const entries = new Map<string, EpisodeIndexEntry>()
    let offset = 0
    let physicalLine = 0
    let validFinalRecordWithoutNewline = false
    try {
      for await (const item of readTextLinesNoFollow(this.file)) {
        physicalLine++
        const lineBytes = Buffer.byteLength(item.line, 'utf8')
        if (!item.line.trim()) {
          offset += lineBytes + (item.newline ? 1 : 0)
          continue
        }
        let episode: Episode
        try { episode = JSON.parse(item.line) as Episode }
        catch {
          if (!item.newline) {
            await truncateFileNoFollow(this.file, offset)
            break
          }
          throw new Error(`memory: corrupt episodic.jsonl at line ${physicalLine}; refusing to rebuild its identity index`)
        }
        entries.set(episode.id, { id: episode.id, offset, length: lineBytes })
        validFinalRecordWithoutNewline = !item.newline
        offset += lineBytes + (item.newline ? 1 : 0)
      }
      if (validFinalRecordWithoutNewline) await appendTextFileNoFollow(this.file, '\n')
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error
    }

    const temporary = `${this.indexFile}.${process.pid}.${randomUUID()}.tmp`
    await assertNoSymlinkParents(this.indexFile)
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        for (const entry of entries.values()) await handle.write(JSON.stringify(entry) + '\n')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await assertNoSymlinkParents(this.indexFile)
      await rename(temporary, this.indexFile)
    } catch (error) {
      const { unlink } = await import('node:fs/promises')
      await unlink(temporary).catch(() => {})
      throw error
    }
    const sourceBytes = await this.fileSize(this.file)
    const indexBytes = await this.fileSize(this.indexFile)
    await this.writeManifest({ version: 1, sourceBytes, indexBytes })
    this.indexCache = { sourceBytes, indexBytes, entries }
    return entries
  }

  async *iterate(): AsyncGenerator<Episode> {
    let candidate: { line: string; lineNumber: number } | undefined
    let physicalLine = 0
    try {
      for await (const item of readTextLinesNoFollow(this.file)) {
        physicalLine++
        if (!item.line.trim()) continue
        if (candidate) {
          try { yield JSON.parse(candidate.line) as Episode }
          catch { throw new Error(`memory: corrupt episodic.jsonl at line ${candidate.lineNumber}`) }
        }
        candidate = { line: item.line, lineNumber: physicalLine }
      }
    } catch (error: any) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    if (candidate) {
      try { yield JSON.parse(candidate.line) as Episode }
      catch { /* An interrupted final write is ignored; the next add() repairs it. */ }
    }
  }

  async findById(id: string): Promise<Episode | undefined> {
    return withFileLock(`${this.file}.lock`, async () => {
      const entry = (await this.ensureIndex()).get(id)
      if (!entry) return undefined
      try {
        const episode = JSON.parse(await readTextRangeNoFollow(this.file, entry.offset, entry.length)) as Episode
        if (episode.id !== id) throw new Error('memory: episodic identity index entry does not match its source record')
        return episode
      } catch (error: any) {
        // A stale or damaged index is never authoritative.
        this.indexCache = undefined
        const rebuilt = await this.rebuildIndex()
        const current = rebuilt.get(id)
        if (!current) return undefined
        const episode = JSON.parse(await readTextRangeNoFollow(this.file, current.offset, current.length)) as Episode
        if (episode.id !== id) throw new Error('memory: rebuilt episodic identity index does not match its source record')
        return episode
      }
    })
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
