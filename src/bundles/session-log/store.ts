import { appendFile, mkdir, open, readFile, readdir, truncate } from 'node:fs/promises'
import { withFileLock } from '../../util/filelock.js'
import { join } from 'node:path'
import type { SessionEvent, SessionStore } from './types.js'

const ID_RE = /^[A-Za-z0-9._-]+$/

/** Guards against path traversal via session ids. */
export function assertValidSessionId(id: string): void {
  if (!ID_RE.test(id) || id === '.' || id === '..') {
    throw new Error(`Invalid session id: ${JSON.stringify(id)}`)
  }
}

export class MemoryStore implements SessionStore {
  private sessions = new Map<string, SessionEvent[]>()

  async append(event: SessionEvent) {
    const list = this.sessions.get(event.sessionId) ?? []
    list.push(structuredClone(event))
    this.sessions.set(event.sessionId, list)
  }
  async read(sessionId: string) {
    return structuredClone(this.sessions.get(sessionId) ?? [])
  }
  async list() {
    return [...this.sessions.keys()]
  }
}

/** One JSONL file per session: `<dir>/<sessionId>.jsonl`. */
export class JsonlStore implements SessionStore {
  constructor(private dir: string) {}

  private file(id: string) {
    assertValidSessionId(id)
    return join(this.dir, `${id}.jsonl`)
  }

  /** Exclude other PROCESSES appending to this session (BUG-07). Held only for one read-tail + one append. */
  async withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    await mkdir(this.dir, { recursive: true })
    return withFileLock(`${this.file(sessionId)}.lock`, fn)
  }

  /**
   * Find the last valid sequence. When the final record is torn, truncate only
   * that incomplete tail while the caller holds withLock(), before any later
   * append can bury it in the middle of the file.
   */
  async lastSeq(sessionId: string): Promise<number> {
    await this.repairTornTail(sessionId)
    let fh
    try {
      fh = await open(this.file(sessionId), 'r')
    } catch (e: any) {
      if (e?.code === 'ENOENT') return 0
      throw e
    }
    try {
      const size = (await fh.stat()).size
      let window = 64 * 1024
      for (;;) {
        const len = Math.min(window, size)
        const buf = Buffer.alloc(len)
        await fh.read(buf, 0, len, size - len)
        const lines = buf.toString('utf8').split('\n')
        const complete = len < size ? lines.slice(1) : lines
        for (let i = complete.length - 1; i >= 0; i--) {
          const line = complete[i]!.trim()
          if (!line) continue
          try {
            const seq = JSON.parse(line).seq
            if (typeof seq === 'number') return seq
          } catch {
            /* malformed final record is repaired before this scan */
          }
        }
        if (len >= size) return 0
        window *= 4
      }
    } finally {
      await fh.close()
    }
  }

  /** Repair a malformed final non-empty line; corruption before it is never discarded. */
  private async repairTornTail(sessionId: string): Promise<void> {
    let text: string
    try {
      text = await readFile(this.file(sessionId), 'utf8')
    } catch (e: any) {
      if (e?.code === 'ENOENT') return
      throw e
    }
    const lines = text.split('\n')
    let end = text.length
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i]!.trim()) continue
      try {
        JSON.parse(lines[i]!)
        return
      } catch {
        const isFinal = lines.slice(i + 1).every((line) => !line.trim())
        if (!isFinal) throw new Error(`Corrupt session log ${sessionId}: line ${i + 1} is not valid JSON`)
        // Keep the newline after the last complete record, removing the bad tail.
        end = lines.slice(0, i).reduce((n, line) => n + line.length + 1, 0)
        await truncate(this.file(sessionId), end)
        return
      }
    }
  }

  async append(event: SessionEvent) {
    await mkdir(this.dir, { recursive: true })
    await appendFile(this.file(event.sessionId), JSON.stringify(event) + '\n', 'utf8')
  }

  async read(sessionId: string): Promise<SessionEvent[]> {
    let text: string
    try {
      text = await readFile(this.file(sessionId), 'utf8')
    } catch (e: any) {
      if (e?.code === 'ENOENT') return []
      throw e
    }
    const lines = text.split('\n')
    const events: SessionEvent[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (!line.trim()) continue
      try {
        events.push(JSON.parse(line))
      } catch {
        const isLast = lines.slice(i + 1).every((l) => !l.trim())
        if (isLast) break
        throw new Error(`Corrupt session log ${sessionId}: line ${i + 1} is not valid JSON`)
      }
    }
    return events
  }

  async list() {
    try {
      const names = await readdir(this.dir)
      return names.filter((n) => n.endsWith('.jsonl')).map((n) => n.slice(0, -6))
    } catch (e: any) {
      if (e?.code === 'ENOENT') return []
      throw e
    }
  }
}
