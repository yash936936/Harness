import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, open, readdir } from 'node:fs/promises'
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

  /**
   * Open a regular session file without following a symlink. Check its identity
   * after opening as a second guard on platforms without O_NOFOLLOW.
   */
  private async openRegular(id: string, flags: number, mode?: number) {
    const file = this.file(id)
    try {
      const before = await lstat(file)
      if (!before.isFile() || before.isSymbolicLink()) {
        throw new Error(`session log ${id}: expected a regular non-symlink file`)
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT' || !(flags & fsConstants.O_CREAT)) throw error
    }

    const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
    const handle = await open(file, flags | noFollow, mode)
    try {
      const opened = await handle.stat()
      const after = await lstat(file)
      if (!after.isFile() || after.isSymbolicLink() ||
          (opened.ino !== 0 && (after.ino !== opened.ino || after.dev !== opened.dev))) {
        throw new Error(`session log ${id}: file changed while opening; refusing`)
      }
      return handle
    } catch (error) {
      await handle.close().catch(() => {})
      throw error
    }
  }

  /** Exclude other PROCESSES appending to this session (BUG-07). Held only for one read-tail + one append. */
  async withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    await mkdir(this.dir, { recursive: true })
    return withFileLock(`${this.file(sessionId)}.lock`, fn)
  }

  /**
   * Find the last valid sequence. When the final record is torn, truncate only
   * that incomplete tail while the caller holds withLock(), before any later
   * append can bury it in the middle.
   */
  async lastSeq(sessionId: string): Promise<number> {
    await this.repairTornTail(sessionId)
    let fh
    try {
      fh = await this.openRegular(sessionId, fsConstants.O_RDONLY)
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

  /** Repair the final tail and reject corruption earlier in the append-only log. */
  private async repairTornTail(sessionId: string): Promise<void> {
    let fh
    try {
      fh = await this.openRegular(sessionId, fsConstants.O_RDWR)
    } catch (e: any) {
      if (e?.code === 'ENOENT') return
      throw e
    }
    try {
      const size = (await fh.stat()).size
      const text = await fh.readFile({ encoding: 'utf8' })
      const lines = text.split('\n')
      let last = lines.length - 1
      while (last >= 0 && !lines[last]!.trim()) last--
      for (let i = 0; i <= last; i++) {
        try {
          JSON.parse(lines[i]!)
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error
          if (i !== last) throw new Error(`Corrupt session log ${sessionId}: line ${i + 1} is not valid JSON`)
          const end = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0)
          await fh.truncate(end)
          return
        }
      }
      if (last >= 0 && !text.endsWith('\n')) await fh.write(Buffer.from('\n'), 0, 1, size)
    } finally {
      await fh.close()
    }
  }

  async append(event: SessionEvent) {
    await mkdir(this.dir, { recursive: true })
    const fh = await this.openRegular(event.sessionId, fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT, 0o600)
    try {
      await fh.appendFile(JSON.stringify(event) + '\n', 'utf8')
    } finally {
      await fh.close()
    }
  }

  async read(sessionId: string): Promise<SessionEvent[]> {
    let fh
    try {
      fh = await this.openRegular(sessionId, fsConstants.O_RDONLY)
    } catch (e: any) {
      if (e?.code === 'ENOENT') return []
      throw e
    }
    let text: string
    try {
      text = await fh.readFile({ encoding: 'utf8' })
    } finally {
      await fh.close()
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
