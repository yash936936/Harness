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
  /** Maximum outstanding appends per session, including the active append. Default 1024. */
  maxPendingAppends?: number
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
  /** Last assigned seq per session; bounded LRU cache, loaded lazily after eviction/restart. */
  private seqs = new Map<string, number>()
  private readonly maxCachedSessions = 256
  /** Serialises appends per session and tracks bounded outstanding work. */
  private queues = new Map<string, { tail: Promise<unknown>; pending: number }>()
  private readonly maxPendingAppends: number
  private redactors = new Set<<T>(value: T) => T>()

  constructor(ctx: Context, config: SessionLogConfig = {}) {
    super(ctx, 'log')
    this.maxPendingAppends = config.maxPendingAppends ?? 1024
    if (!Number.isSafeInteger(this.maxPendingAppends) || this.maxPendingAppends < 1) {
      throw new Error('session log: maxPendingAppends must be a positive safe integer')
    }
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
    // Snapshot before queueing or waiting for a cross-process lock. Otherwise
    // callers could mutate an object after append() and change the audit record.
    const payload = data === undefined || data === null ? data : structuredClone(data)
    const job = async () => {
      // A store shared between processes (BUG-07) is asked for the real last seq under its lock; the in-process cache is only trusted when it is not.
      const last = store.lastSeq ? await store.lastSeq(sessionId) : await this.lastSeq(sessionId)
      // SEC-01: the one place every event passes through, so redaction here covers tool.call,
      // tool.result, approval.pending, model.* and anything a later bundle adds.
      let stored = payload
      if (stored !== undefined && stored !== null) for (const r of this.redactors) stored = r(stored)
      const event: SessionEvent = {
        seq: last + 1,
        ts: new Date().toISOString(),
        sessionId,
        type,
        ...(actor ? { actor } : {}),
        data: stored === undefined ? null : stored,
      }
      // Fail loudly on non-serialisable payloads instead of silently dropping fields.
      JSON.stringify(event)
      await this.store.append(event)
      this.rememberSeq(sessionId, event.seq)
      return event
    }
    return this.enqueue(sessionId, () => (store.withLock ? store.withLock(sessionId, job) : job()))
  }

  /** All events of a session, in order. */
  read(sessionId: string): Promise<SessionEvent[]> {
    return this.store.read(sessionId)
  }

  /** Read an inclusive sequence range without loading the entire session. */
  async readRange(sessionId: string, fromSeq: number, toSeq: number): Promise<SessionEvent[]> {
    assertValidSessionId(sessionId)
    if (!Number.isSafeInteger(fromSeq) || !Number.isSafeInteger(toSeq) || fromSeq < 1 || toSeq < fromSeq) {
      throw new Error(`session log ${sessionId}: invalid sequence range ${fromSeq}..${toSeq}`)
    }
    if (this.store.readRange) return this.store.readRange(sessionId, fromSeq, toSeq)
    return (await this.store.read(sessionId)).filter((event) => event.seq >= fromSeq && event.seq <= toSeq)
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
    if (cached !== undefined) {
      this.seqs.delete(sessionId)
      this.seqs.set(sessionId, cached)
      return cached
    }
    const events = await this.store.read(sessionId)
    const last = events.length ? events[events.length - 1]!.seq : 0
    this.rememberSeq(sessionId, last)
    return last
  }

  private rememberSeq(sessionId: string, seq: number): void {
    this.seqs.delete(sessionId)
    this.seqs.set(sessionId, seq)
    if (this.seqs.size > this.maxCachedSessions) {
      const oldest = this.seqs.keys().next().value as string | undefined
      if (oldest !== undefined) this.seqs.delete(oldest)
    }
  }

  private enqueue<T>(sessionId: string, job: () => Promise<T>): Promise<T> {
    let queue = this.queues.get(sessionId)
    if (!queue) {
      queue = { tail: Promise.resolve(), pending: 0 }
      this.queues.set(sessionId, queue)
    }
    if (queue.pending >= this.maxPendingAppends) {
      if (queue.pending === 0 && this.queues.get(sessionId) === queue) this.queues.delete(sessionId)
      throw new Error(`session log ${sessionId}: pending append queue is full (${queue.pending}/${this.maxPendingAppends})`)
    }
    queue.pending++
    const next = queue.tail.then(job, job)
    queue.tail = next.catch(() => {})
    void next.then(
      () => this.finishAppend(sessionId, queue!),
      () => this.finishAppend(sessionId, queue!),
    )
    return next
  }

  private finishAppend(sessionId: string, queue: { tail: Promise<unknown>; pending: number }): void {
    queue.pending--
    if (queue.pending === 0 && this.queues.get(sessionId) === queue) this.queues.delete(sessionId)
  }
}

export const name = 'bundle-session-log'
export function apply(ctx: Context, config: SessionLogConfig = {}) {
  ctx.plugin(SessionLog, config)
}
