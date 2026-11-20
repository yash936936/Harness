import { mkdir, open, rename, stat, writeFile, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { withFileLock } from '../../util/filelock.js'
import { appendTextFileNoFollow, assertNoSymlinkParents, readTextFileNoFollow, readTextLinesNoFollow, readTextRangeNoFollow, truncateFileNoFollow } from '../../util/secure-file.js'
import { MemoryError, type SemanticFact } from './types.js'

type SemanticEvent = { op: 'put'; fact: SemanticFact } | { op: 'delete'; id: string }
interface SemanticIndexEntry { id: string; offset: number; length: number; textKey?: string; deleted?: boolean }
interface SemanticManifest { version: 1; sourceBytes: number; indexBytes: number }
export interface SemanticReindexCheckpoint {
  version: 1
  sourceBytes: number
  fingerprint: string
  dimensions: number
  collection: string
  resetRequested: boolean
  resetApplied: boolean
  cursor?: string
  indexed: number
  updatedAt: string
}
interface SemanticIndex { sourceBytes: number; indexBytes: number; byId: Map<string, SemanticIndexEntry>; byText: Map<string, string> }

const textKey = (text: string) => text.toLowerCase()

function validFact(fact: any): fact is SemanticFact {
  return !!fact && typeof fact === 'object' && !Array.isArray(fact) &&
    fact.tier === 'semantic' && typeof fact.id === 'string' && !!fact.id.trim() &&
    typeof fact.text === 'string' && !!fact.text.trim() &&
    typeof fact.why === 'string' && !!fact.why.trim() &&
    typeof fact.ts === 'string' && Number.isFinite(Date.parse(fact.ts)) &&
    (fact.updatedTs === undefined || (typeof fact.updatedTs === 'string' && Number.isFinite(Date.parse(fact.updatedTs)))) &&
    (fact.source === undefined || typeof fact.source === 'string') &&
    (fact.tags === undefined || (Array.isArray(fact.tags) && fact.tags.every((tag: unknown) => typeof tag === 'string')))
}

/** Append-only semantic history. semantic.json is retained as the migration backup. */
export class SemanticFactStore {
  private cache?: SemanticIndex
  private readonly memoryFacts = new Map<string, SemanticFact>()
  private memoryRevision = 0
  constructor(private readonly dir?: string) {}

  private get sourceFile() { return join(this.dir!, 'semantic.events.jsonl') }
  private get indexFile() { return join(this.dir!, 'semantic.index.jsonl') }
  private get manifestFile() { return join(this.dir!, 'semantic.index.meta.json') }
  private get checkpointFile() { return join(this.dir!, 'semantic.reindex.checkpoint.json') }
  private get lockFile() { return join(this.dir!, 'semantic.events.jsonl.lock') }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.dir) return fn()
    await assertNoSymlinkParents(this.sourceFile)
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    await assertNoSymlinkParents(this.sourceFile)
    return withFileLock(this.lockFile, async () => { await this.migrateLegacy(); return fn() })
  }

  private async fileSize(path: string): Promise<number> {
    try { return (await stat(path)).size }
    catch (error: any) { if (error?.code === 'ENOENT') return 0; throw error }
  }

  private async migrateLegacy(): Promise<void> {
    try { await stat(this.sourceFile); return }
    catch (error: any) { if (error?.code !== 'ENOENT') throw error }
    let legacy: SemanticFact[] = []
    try {
      const parsed = JSON.parse(await readTextFileNoFollow(join(this.dir!, 'semantic.json')))
      if (!Array.isArray(parsed)) throw new Error('not an array')
      for (const [index, fact] of parsed.entries()) if (!validFact(fact)) throw new Error(`invalid fact at index ${index}`)
      legacy = parsed
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw new MemoryError(`memory: semantic.json is unreadable (${error?.message ?? error}); refusing to migrate or overwrite it`)
    }
    const temporary = `${this.sourceFile}.${process.pid}.${randomUUID()}.tmp`
    await assertNoSymlinkParents(this.sourceFile)
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        for (const fact of legacy) await handle.write(JSON.stringify({ op: 'put', fact } satisfies SemanticEvent) + '\n')
        await handle.sync()
      } finally { await handle.close() }
      await assertNoSymlinkParents(this.sourceFile)
      await rename(temporary, this.sourceFile)
    } catch (error) {
      await unlink(temporary).catch(() => {})
      throw error
    }
    this.cache = undefined
  }

  private async readManifest(): Promise<SemanticManifest | undefined> {
    try {
      const parsed = JSON.parse(await readTextFileNoFollow(this.manifestFile)) as Partial<SemanticManifest>
      if (parsed.version !== 1 || !Number.isSafeInteger(parsed.sourceBytes) || parsed.sourceBytes! < 0 ||
          !Number.isSafeInteger(parsed.indexBytes) || parsed.indexBytes! < 0) return undefined
      return parsed as SemanticManifest
    } catch { return undefined }
  }

  private apply(index: SemanticIndex, entry: SemanticIndexEntry): void {
    const previous = index.byId.get(entry.id)
    if (previous?.textKey && index.byText.get(previous.textKey) === entry.id) index.byText.delete(previous.textKey)
    if (entry.deleted) { index.byId.delete(entry.id); return }
    index.byId.set(entry.id, entry)
    if (entry.textKey) index.byText.set(entry.textKey, entry.id)
  }

  private async ensureIndex(): Promise<SemanticIndex> {
    const sourceBytes = await this.fileSize(this.sourceFile)
    const indexBytes = await this.fileSize(this.indexFile)
    if (this.cache?.sourceBytes === sourceBytes && this.cache.indexBytes === indexBytes) return this.cache
    const manifest = await this.readManifest()
    if (manifest?.sourceBytes === sourceBytes && manifest.indexBytes === indexBytes) {
      try {
        const index: SemanticIndex = { sourceBytes, indexBytes, byId: new Map(), byText: new Map() }
        for await (const item of readTextLinesNoFollow(this.indexFile)) {
          if (!item.line.trim()) continue
          const entry = JSON.parse(item.line) as SemanticIndexEntry
          if (typeof entry.id !== 'string' || !entry.id || !Number.isSafeInteger(entry.offset) || entry.offset < 0 ||
              !Number.isSafeInteger(entry.length) || entry.length < 1 || entry.offset + entry.length > sourceBytes ||
              (entry.deleted !== undefined && typeof entry.deleted !== 'boolean') ||
              (entry.textKey !== undefined && typeof entry.textKey !== 'string')) throw new Error('invalid semantic index entry')
          this.apply(index, entry)
        }
        this.cache = index
        return index
      } catch { /* rebuild disposable projection */ }
    }
    return this.rebuildIndex()
  }

  private async rebuildIndex(): Promise<SemanticIndex> {
    const index: SemanticIndex = { sourceBytes: 0, indexBytes: 0, byId: new Map(), byText: new Map() }
    let offset = 0, lineNumber = 0, validFinalRecordWithoutNewline = false
    const temporary = `${this.indexFile}.${process.pid}.${randomUUID()}.tmp`
    await assertNoSymlinkParents(this.indexFile)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      for await (const item of readTextLinesNoFollow(this.sourceFile)) {
        lineNumber++
        const length = Buffer.byteLength(item.line, 'utf8')
        if (!item.line.trim()) { offset += length + (item.newline ? 1 : 0); continue }
        let event: SemanticEvent
        try { event = JSON.parse(item.line) as SemanticEvent }
        catch {
          if (!item.newline) { await truncateFileNoFollow(this.sourceFile, offset); break }
          throw new MemoryError(`memory: corrupt semantic event log at line ${lineNumber}; refusing to rebuild its index`)
        }
        let entry: SemanticIndexEntry
        if (event.op === 'put' && validFact(event.fact)) entry = { id: event.fact.id, offset, length, textKey: textKey(event.fact.text) }
        else if (event.op === 'delete' && typeof event.id === 'string' && event.id) entry = { id: event.id, offset, length, deleted: true }
        else throw new MemoryError(`memory: invalid semantic event at line ${lineNumber}; refusing to rebuild its index`)
        await handle.write(JSON.stringify(entry) + '\n')
        this.apply(index, entry)
        validFinalRecordWithoutNewline = !item.newline
        offset += length + (item.newline ? 1 : 0)
      }
      if (validFinalRecordWithoutNewline) await appendTextFileNoFollow(this.sourceFile, '\n')
      await handle.sync()
    } catch (error: any) {
      await handle.close().catch(() => {})
      await unlink(temporary).catch(() => {})
      if (error?.code !== 'ENOENT') throw error
    }
    await handle.close().catch(() => {})
    try {
      await assertNoSymlinkParents(this.indexFile)
      await rename(temporary, this.indexFile)
    } catch (error) { await unlink(temporary).catch(() => {}); throw error }
    index.sourceBytes = await this.fileSize(this.sourceFile)
    index.indexBytes = await this.fileSize(this.indexFile)
    await this.writeManifest({ version: 1, sourceBytes: index.sourceBytes, indexBytes: index.indexBytes })
    this.cache = index
    return index
  }

  private async writeManifest(manifest: SemanticManifest): Promise<void> {
    const temporary = `${this.manifestFile}.${process.pid}.${randomUUID()}.tmp`
    await assertNoSymlinkParents(this.manifestFile)
    try {
      await writeFile(temporary, JSON.stringify(manifest), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await assertNoSymlinkParents(this.manifestFile)
      await rename(temporary, this.manifestFile)
    } catch (error) { await unlink(temporary).catch(() => {}); throw error }
  }

  private async getFrom(id: string, index: SemanticIndex): Promise<SemanticFact | undefined> {
    const entry = index.byId.get(id)
    if (!entry) return undefined
    const event = JSON.parse(await readTextRangeNoFollow(this.sourceFile, entry.offset, entry.length)) as SemanticEvent
    if (event.op !== 'put' || !validFact(event.fact) || event.fact.id !== id) throw new MemoryError('memory: semantic identity index does not match its source event')
    return event.fact
  }

  async get(id: string) {
    if (!this.dir) {
      const fact = this.memoryFacts.get(id)
      return fact ? structuredClone(fact) : undefined
    }
    return this.getFrom(id, await this.ensureIndex())
  }
  async findByText(text: string) {
    if (!this.dir) {
      const key = textKey(text)
      for (const fact of this.memoryFacts.values()) if (textKey(fact.text) === key) return structuredClone(fact)
      return undefined
    }
    const index = await this.ensureIndex(), id = index.byText.get(textKey(text))
    return id ? this.getFrom(id, index) : undefined
  }

  async put(fact: SemanticFact): Promise<{ fact: SemanticFact; created: boolean }> {
    if (!this.dir) {
      const duplicate = [...this.memoryFacts.values()].find((item) => textKey(item.text) === textKey(fact.text) && item.id !== fact.id)
      if (duplicate) return { fact: structuredClone(duplicate), created: false }
      const previous = this.memoryFacts.get(fact.id)
      const stored = previous ? { ...fact, ts: previous.ts, updatedTs: fact.ts } : { ...fact, updatedTs: undefined }
      this.memoryFacts.set(stored.id, structuredClone(stored))
      this.memoryRevision++
      return { fact: structuredClone(stored), created: true }
    }
    const index = await this.ensureIndex()
    const duplicateId = index.byText.get(textKey(fact.text))
    if (duplicateId && duplicateId !== fact.id) {
      const duplicate = await this.getFrom(duplicateId, index)
      if (duplicate) return { fact: duplicate, created: false }
    }
    const previous = await this.getFrom(fact.id, index)
    const stored = previous ? { ...fact, ts: previous.ts, updatedTs: fact.ts } : { ...fact, updatedTs: undefined }
    const line = JSON.stringify({ op: 'put', fact: stored } satisfies SemanticEvent) + '\n'
    const offset = index.sourceBytes, length = Buffer.byteLength(line, 'utf8') - 1
    await appendTextFileNoFollow(this.sourceFile, line)
    const entry = { id: stored.id, offset, length, textKey: textKey(stored.text) }
    await appendTextFileNoFollow(this.indexFile, JSON.stringify(entry) + '\n')
    index.sourceBytes += Buffer.byteLength(line, 'utf8')
    index.indexBytes = await this.fileSize(this.indexFile)
    this.apply(index, entry)
    await this.writeManifest({ version: 1, sourceBytes: index.sourceBytes, indexBytes: index.indexBytes })
    this.cache = index
    return { fact: stored, created: true }
  }

  async delete(id: string): Promise<SemanticFact | undefined> {
    if (!this.dir) {
      const previous = this.memoryFacts.get(id)
      if (!previous) return undefined
      this.memoryFacts.delete(id)
      this.memoryRevision++
      return structuredClone(previous)
    }
    const index = await this.ensureIndex(), previous = await this.getFrom(id, index)
    if (!previous) return undefined
    const line = JSON.stringify({ op: 'delete', id } satisfies SemanticEvent) + '\n'
    const offset = index.sourceBytes, length = Buffer.byteLength(line, 'utf8') - 1
    await appendTextFileNoFollow(this.sourceFile, line)
    const entry = { id, offset, length, deleted: true }
    await appendTextFileNoFollow(this.indexFile, JSON.stringify(entry) + '\n')
    index.sourceBytes += Buffer.byteLength(line, 'utf8')
    index.indexBytes = await this.fileSize(this.indexFile)
    this.apply(index, entry)
    await this.writeManifest({ version: 1, sourceBytes: index.sourceBytes, indexBytes: index.indexBytes })
    this.cache = index
    return previous
  }

  get persistent(): boolean { return !!this.dir }

  async revision(): Promise<number> {
    return this.dir ? (await this.ensureIndex()).sourceBytes : this.memoryRevision
  }

  async page(afterId: string | undefined, limit: number): Promise<{ items: SemanticFact[]; sourceBytes: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new MemoryError('memory: semantic page limit must be a positive safe integer')
    if (!this.dir) {
      const values = [...this.memoryFacts.values()]
      const start = afterId === undefined ? 0 : values.findIndex((fact) => fact.id === afterId) + 1
      if (afterId !== undefined && start === 0) throw new MemoryError('memory: semantic page cursor is stale')
      return { items: values.slice(start, start + limit).map((fact) => structuredClone(fact)), sourceBytes: this.memoryRevision }
    }
    const index = await this.ensureIndex()
    let started = afterId === undefined
    let cursorFound = started
    const items: SemanticFact[] = []
    for (const id of index.byId.keys()) {
      if (!started) {
        if (id === afterId) { started = true; cursorFound = true }
        continue
      }
      if (items.length >= limit) break
      const fact = await this.getFrom(id, index)
      if (fact) items.push(fact)
    }
    if (!cursorFound) throw new MemoryError('memory: semantic page cursor is stale')
    return { items, sourceBytes: index.sourceBytes }
  }

  async loadReindexCheckpoint(): Promise<SemanticReindexCheckpoint | undefined> {
    if (!this.dir) return undefined
    try {
      const value = JSON.parse(await readTextFileNoFollow(this.checkpointFile)) as Partial<SemanticReindexCheckpoint>
      if (value.version !== 1 || !Number.isSafeInteger(value.sourceBytes) || value.sourceBytes! < 0 ||
          typeof value.fingerprint !== 'string' || !value.fingerprint ||
          !Number.isSafeInteger(value.dimensions) || value.dimensions! < 1 ||
          typeof value.collection !== 'string' || !value.collection ||
          typeof value.resetRequested !== 'boolean' || typeof value.resetApplied !== 'boolean' ||
          (value.cursor !== undefined && typeof value.cursor !== 'string') ||
          !Number.isSafeInteger(value.indexed) || value.indexed! < 0 ||
          typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return undefined
      return value as SemanticReindexCheckpoint
    } catch { return undefined }
  }

  async saveReindexCheckpoint(checkpoint: SemanticReindexCheckpoint): Promise<void> {
    if (!this.dir) return
    const temporary = `${this.checkpointFile}.${process.pid}.${randomUUID()}.tmp`
    await assertNoSymlinkParents(this.checkpointFile)
    try {
      await writeFile(temporary, JSON.stringify(checkpoint), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await assertNoSymlinkParents(this.checkpointFile)
      await rename(temporary, this.checkpointFile)
    } catch (error) { await unlink(temporary).catch(() => {}); throw error }
  }

  async clearReindexCheckpoint(): Promise<void> {
    if (!this.dir) return
    await unlink(this.checkpointFile).catch((error: any) => { if (error?.code !== 'ENOENT') throw error })
  }

  async count() { return this.dir ? (await this.ensureIndex()).byId.size : this.memoryFacts.size }
  async all() {
    if (!this.dir) return [...this.memoryFacts.values()].map((fact) => structuredClone(fact))
    const index = await this.ensureIndex(), result: SemanticFact[] = []
    for (const id of index.byId.keys()) { const fact = await this.getFrom(id, index); if (fact) result.push(fact) }
    return result
  }
  async *iterate() {
    if (!this.dir) {
      for (const fact of this.memoryFacts.values()) yield structuredClone(fact)
      return
    }
    const index = await this.ensureIndex()
    for (const id of index.byId.keys()) { const fact = await this.getFrom(id, index); if (fact) yield fact }
  }
}
