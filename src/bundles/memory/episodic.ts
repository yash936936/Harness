// Records and queries per-turn episodic memory linked to session-log events.
import type { Context } from 'cordis'
import type { SessionEvent } from '../session-log/index.js'
import { MemoryError, type Episode, type EpisodeQuery, type EpisodeStore, type RecordTurnInput } from './types.js'

function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + '…'
}

/** `search_code -> read x2 -> search_code`: consecutive repeats collapse, order is kept. */
export function summariseApproach(events: SessionEvent[]): { approach: string; toolCalls: number } {
  const names: string[] = []
  for (const e of events) {
    if (e.type !== 'tool.call') continue
    const n = (e.data as { name?: unknown } | null)?.name
    if (typeof n === 'string') names.push(n)
  }
  const parts: { name: string; count: number }[] = []
  for (const n of names) {
    const last = parts[parts.length - 1]
    if (last && last.name === n) last.count++
    else parts.push({ name: n, count: 1 })
  }
  const text = parts.map((p) => (p.count > 1 ? `${p.name} x${p.count}` : p.name)).join(' -> ')
  return { approach: text || 'no tools used', toolCalls: names.length }
}

/** `ctx.memory.episodic`: the episodic tier (3.1). */
export class EpisodicMemory {
  constructor(
    private store: EpisodeStore,
    private ctx: Context,
    private maxChars: number,
    private now: () => Date,
  ) {}

  /**
   * Write the one entry for a turn. Task, approach and result come from the
   * caller and the session log; `lesson` only if the caller supplies it.
   * Writing the same turn twice returns the existing entry, not a second one.
   */
  async record(input: RecordTurnInput): Promise<{ episode: Episode; created: boolean }> {
    if (!Number.isInteger(input.fromSeq) || !Number.isInteger(input.toSeq) || input.fromSeq < 1 || input.toSeq < input.fromSeq) {
      throw new MemoryError(`memory: invalid seq range ${input.fromSeq}..${input.toSeq}`)
    }
    const events = (await this.ctx.log.read(input.sessionId)).filter((e) => e.seq >= input.fromSeq && e.seq <= input.toSeq)
    if (events.length === 0) throw new MemoryError(`memory: session ${input.sessionId} has no events in ${input.fromSeq}..${input.toSeq}`)
    const { approach, toolCalls } = summariseApproach(events)
    let episode: Episode = {
      id: `${input.sessionId}:${input.fromSeq}`,
      sessionId: input.sessionId,
      agentId: input.agentId ?? 'main',
      ts: this.now().toISOString(),
      task: clip(input.task, this.maxChars),
      approach: clip(approach, this.maxChars),
      result: clip(input.result, this.maxChars),
      outcome: input.outcome,
      lesson: input.lesson ? clip(input.lesson, this.maxChars) : null,
      fromSeq: input.fromSeq,
      toSeq: input.toSeq,
      steps: input.steps ?? 0,
      toolCalls,
    }
    // Memory is written to disk and later fed back to models: a registered secret must not ride along.
    episode = this.ctx.egress.redactValue(episode)
    const created = await this.store.add(episode)
    if (!created) {
      const existing = this.store.findById
        ? await this.store.findById(episode.id)
        : (await this.store.all()).find((e) => e.id === episode.id)
      if (!existing) throw new MemoryError(`memory: episode ${episode.id} already exists but could not be read`)
      return { episode: this.ctx.egress.redactValue(existing), created: false }
    }
    return { episode, created: true }
  }

  /** Stream redacted episodes in storage order for bounded-memory consumers. */
  async *iterate(): AsyncGenerator<Episode> {
    if (this.store.iterate) {
      for await (const episode of this.store.iterate()) yield this.ctx.egress.redactValue(episode)
      return
    }
    for (const episode of await this.store.all()) yield this.ctx.egress.redactValue(episode)
  }

  /** Count without materialising the episode collection when the store supports it. */
  async count(): Promise<number> {
    if (this.store.count) return this.store.count()
    let count = 0
    for await (const _episode of this.iterate()) count++
    return count
  }

  async query(q: EpisodeQuery = {}): Promise<Episode[]> {
    const needle = q.task?.toLowerCase()
    const matches = (e: Episode) =>
      (q.sessionId === undefined || e.sessionId === q.sessionId) &&
      (q.agentId === undefined || e.agentId === q.agentId) &&
      (q.outcome === undefined || e.outcome === q.outcome) &&
      (needle === undefined || e.task.toLowerCase().includes(needle)) &&
      (q.from === undefined || e.ts >= q.from) &&
      (q.to === undefined || e.ts < q.to)
    const compareAsc = (a: Episode, b: Episode) =>
      a.ts === b.ts ? a.sessionId.localeCompare(b.sessionId) || a.fromSeq - b.fromSeq : a.ts < b.ts ? -1 : 1

    if (q.limit !== undefined) {
      const limit = Math.trunc(Math.max(0, q.limit))
      if (!(limit > 0)) return []
      const descending = q.order === 'desc'
      const selected: Array<{ episode: Episode; ordinal: number }> = []
      let ordinal = 0
      for await (const episode of this.iterate()) {
        if (!matches(episode)) { ordinal++; continue }
        const entry = { episode, ordinal: ordinal++ }
        const compare = (a: typeof entry, b: typeof entry) => {
          const order = compareAsc(a.episode, b.episode)
          return (descending ? -order : order) || (descending ? b.ordinal - a.ordinal : a.ordinal - b.ordinal)
        }
        let low = 0
        let high = selected.length
        while (low < high) {
          const middle = (low + high) >>> 1
          if (compare(selected[middle]!, entry) <= 0) low = middle + 1
          else high = middle
        }
        selected.splice(low, 0, entry)
        if (selected.length > limit) selected.pop()
      }
      return selected.map((entry) => entry.episode)
    }

    const items: Episode[] = []
    for await (const episode of this.iterate()) if (matches(episode)) items.push(episode)
    items.sort(compareAsc)
    if (q.order === 'desc') items.reverse()
    return items
  }

  /** True when the log still holds the events this entry points at. */
  async verifyLink(e: Episode): Promise<boolean> {
    const events = await this.ctx.log.read(e.sessionId)
    return events.some((x) => x.seq === e.fromSeq) && events.some((x) => x.seq === e.toSeq)
  }
}
