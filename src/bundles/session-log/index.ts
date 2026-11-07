import { Context, Service } from 'cordis'
import { randomUUID } from 'node:crypto'
import { JsonlStore, MemoryStore, assertValidSessionId } from './store.js'
import type { ForkOrigin, SessionEvent, SessionStore } from './types.js'

export * from './types.js'
export { JsonlStore, MemoryStore } from './store.js'

export interface SessionLogConfig {
  /** Directory for JSONL files. Omit (or set `memory`) to keep the log in memory. */
  path?: string
  memory?: boolean
}

declare module 'cordis' {
  interface Context {
    log: SessionLog
  }
}

/**
 * `ctx.log` — append-only event log. Foundation bundle: everything else
 * depends on it, and it depends on nothing.
 *
 * Invariant enforced by the rest of the harness (not by this bundle alone):
 * anything the model can see is appended here first ("model-visible = logged").
 */
export class SessionLog extends Service {
  private store: SessionStore
  /** Last assigned seq per session; loaded lazily so resume works after restart. */
  private seqs = new Map<string, number>()
  /** Serialises appends per session so seq order equals file order. */
  private queues = new Map<string, Promise<unknown>>()
  private redactors = new Set<<T>(value: T) => T>()

  constructor(ctx: Context, config: SessionLogConfig = {}) {
    super(ctx, 'log')
    this.store = config.path && !config.memory ? new JsonlStore(config.path) : new MemoryStore()
  }

  /**
   * Register a payload redactor applied to every event before it is stored (SEC-01). Called by
   * `ctx.egress` when both services exist, so this foundation bundle still depends on nothing.
   * Returns a disposer.
   */
  addRedactor(fn: <T>(value: T) => T): () => void {
    this.redactors.add(fn)
    return () => void this.redactors.delete(fn)
  }

  /** Start a new session and return its id. */
  create(id: string = randomUUID()): string {
    assertValidSessionId(id)
    return id
  }

  async append(sessionId: string, type: string, data: unknown = null, actor?: string): Promise<SessionEvent> {
    assertValidSessionId(sessionId)
    const store = this.store
    const job = async () => {
      // A store shared between processes (BUG-07) is asked for the real last seq under its lock; the in-process cache is only trusted when it is not.
      const last = store.lastSeq ? await store.lastSeq(sessionId) : await this.lastSeq(sessionId)
      // SEC-01: the one place every event passes through, so redaction here covers tool.call,
      // tool.result, approval.pending, model.* and anything a later bundle adds.
      if (data !== undefined && data !== null) for (const r of this.redactors) data = r(data)
      const event: SessionEvent = {
        seq: last + 1,
        ts: new Date().toISOString(),
        sessionId,
        type,
        ...(actor ? { actor } : {}),
        data: data === undefined ? null : data,
      }
      // Fail loudly on non-serialisable payloads instead of silently dropping fields.
      JSON.stringify(event)
      await this.store.append(event)
      this.seqs.set(sessionId, event.seq)
      return event
    }
    return this.enqueue(sessionId, () => (store.withLock ? store.withLock(sessionId, job) : job()))
  }

  /** All events of a session, in order. */
  read(sessionId: string): Promise<SessionEvent[]> {
    return this.store.read(sessionId)
  }

  /** Async-iterate events in order (replay). */
  async *replay(sessionId: string, fromSeq = 1): AsyncGenerator<SessionEvent> {
    for (const e of await this.read(sessionId)) if (e.seq >= fromSeq) yield e
  }

  /** Session ids known to the store. */
  list(): Promise<string[]> {
    return this.store.list()
  }

  /** Next seq a resumed session will use (0 events -> 1). */
  async resume(sessionId: string): Promise<{ sessionId: string; nextSeq: number }> {
    return { sessionId, nextSeq: (await this.lastSeq(sessionId)) + 1 }
  }

  /**
   * Copy events 1..atSeq into a new session, prefixed by a `session.fork`
   * marker. The original is never modified.
   */
  async fork(sessionId: string, atSeq?: number, newId: string = randomUUID()): Promise<string> {
    assertValidSessionId(newId)
    const source = await this.read(sessionId)
    if (!source.length) throw new Error(`Cannot fork unknown or empty session: ${sessionId}`)
    const cut = atSeq ?? source[source.length - 1]!.seq
    if (!source.some((e) => e.seq === cut)) throw new Error(`Session ${sessionId} has no seq ${cut}`)
    if ((await this.lastSeq(newId)) > 0) throw new Error(`Session ${newId} already exists`)
    const origin: ForkOrigin = { fromSession: sessionId, atSeq: cut }
    await this.append(newId, 'session.fork', origin)
    for (const e of source) {
      if (e.seq > cut) break
      await this.append(newId, e.type, e.data, e.actor)
    }
    return newId
  }

  private async lastSeq(sessionId: string): Promise<number> {
    // A JSONL store may be shared by several processes. Never trust this
    // instance's cache for it, and hold its lock while repairing/reading the tail.
    if (this.store.lastSeq) {
      const read = () => this.store.lastSeq!(sessionId)
      return this.store.withLock ? this.store.withLock(sessionId, read) : read()
    }
    const cached = this.seqs.get(sessionId)
    if (cached !== undefined) return cached
    const events = await this.store.read(sessionId)
    const last = events.length ? events[events.length - 1]!.seq : 0
    this.seqs.set(sessionId, last)
    return last
  }

  private enqueue<T>(sessionId: string, job: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(sessionId) ?? Promise.resolve()
    const next = prev.then(job, job)
    this.queues.set(sessionId, next.catch(() => {}))
    return next
  }
}

export const name = 'bundle-session-log'
export function apply(ctx: Context, config: SessionLogConfig = {}) {
  ctx.plugin(SessionLog, config)
}
