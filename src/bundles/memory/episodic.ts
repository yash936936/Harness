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
      const existing = (await this.store.all()).find((e) => e.id === episode.id)!
      return { episode: this.ctx.egress.redactValue(existing), created: false }
    }
    return { episode, created: true }
  }

  async query(q: EpisodeQuery = {}): Promise<Episode[]> {
    const needle = q.task?.toLowerCase()
    let items = (await this.store.all()).map((episode) => this.ctx.egress.redactValue(episode)).filter(
      (e) =>
        (q.sessionId === undefined || e.sessionId === q.sessionId) &&
        (q.agentId === undefined || e.agentId === q.agentId) &&
        (q.outcome === undefined || e.outcome === q.outcome) &&
        (needle === undefined || e.task.toLowerCase().includes(needle)) &&
        (q.from === undefined || e.ts >= q.from) &&
        (q.to === undefined || e.ts < q.to),
    )
    items.sort((a, b) => (a.ts === b.ts ? a.sessionId.localeCompare(b.sessionId) || a.fromSeq - b.fromSeq : a.ts < b.ts ? -1 : 1))
    if (q.order === 'desc') items.reverse()
    if (q.limit !== undefined) items = items.slice(0, Math.max(0, q.limit))
    return items
  }

  /** True when the log still holds the events this entry points at. */
  async verifyLink(e: Episode): Promise<boolean> {
    const events = await this.ctx.log.read(e.sessionId)
    return events.some((x) => x.seq === e.fromSeq) && events.some((x) => x.seq === e.toSeq)
  }
}
