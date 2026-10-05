import { Context, Service } from 'cordis'
import type { RunResult, RunTaskOptions } from '../agent-loop/index.js'
import type { SessionEvent } from '../session-log/index.js'
import { JsonlEpisodeStore, MemoryEpisodeStore } from './store.js'
import { HotTier, defaultEstimateTokens } from './hot.js'
import { Compaction } from './compaction.js'
import {
  MemoryError,
  type Episode,
  type EpisodeQuery,
  type EpisodeStore,
  type CompactionResult,
  type MemoryConfig,
  type HotView,
  type PromotionCandidate,
  type RecordTurnInput,
  type ScopedMemory,
} from './types.js'
import { MemoryAccess, isScopedActor, type MemoryGrant } from './access.js'

export * from './types.js'
export { JsonlEpisodeStore, MemoryEpisodeStore } from './store.js'
export { HotTier, HOT_HEADER, defaultEstimateTokens } from './hot.js'
export { MemorySemantic, type AddResult } from './semantic.js'
export { normaliseLesson, lessonId } from './compaction.js'
export { MemoryAccess, SCOPED_ACTOR_PREFIX, isScopedActor, type MemoryGrant } from './access.js'

declare module 'cordis' {
  interface Context {
    memory: Memory
  }
}

const DEFAULT_MAX_CHARS = 2000
const DEFAULT_HOT_CAP = 2000

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
      return { episode: existing, created: false }
    }
    return { episode, created: true }
  }

  async query(q: EpisodeQuery = {}): Promise<Episode[]> {
    const needle = q.task?.toLowerCase()
    let items = (await this.store.all()).filter(
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

/**
 * `ctx.memory` (Phase 3). Built: episodic (3.1) and hot (3.2). The semantic tier
 * (3.3) is a separate service, `ctx.memorySemantic` (see semantic.ts). Compaction
 * and skills are 3.4-3.5 and are not present yet.
 *
 * Needs `log` (events to link to), `egress` (memory is written to disk and
 * later shown to models, so registered secrets are redacted first; egress is
 * mandatory in every profile, D-029) and `agentLoop` (for `runTurn`).
 */
export class Memory extends Service {
  static inject = ['log', 'egress', 'agentLoop']

  readonly episodic: EpisodicMemory
  readonly hot: HotTier
  /** Live grants for sub-agent actors (D-073). `subagent-scope` writes it; nothing else should. */
  readonly access = new MemoryAccess()
  private readonly compaction: Compaction
  private readonly everyTurns: number | undefined
  /** The most recent automatic compaction (3.4): its result, or the error that stopped it. Never thrown into a user's turn. */
  lastCompaction: { ts: string; result?: CompactionResult; error?: string } | undefined

  constructor(ctx: Context, config: MemoryConfig = {}) {
    super(ctx, 'memory')
    const store = config.path ? new JsonlEpisodeStore(config.path) : new MemoryEpisodeStore()
    const now = config.now ?? (() => new Date())
    this.episodic = new EpisodicMemory(store, ctx, config.maxFieldChars ?? DEFAULT_MAX_CHARS, now)
    this.hot = new HotTier(ctx, config.path, config.hotTokenCap ?? DEFAULT_HOT_CAP, config.estimateTokens ?? defaultEstimateTokens, now)
    this.everyTurns = config.compaction?.everyTurns
    if (this.everyTurns !== undefined && (!Number.isInteger(this.everyTurns) || this.everyTurns < 1)) throw new MemoryError('memory: compaction.everyTurns must be a positive integer')
    this.compaction = new Compaction(
      this.episodic,
      this.hot,
      config.path,
      { minOccurrences: config.compaction?.minOccurrences ?? 3, promotedPriority: config.compaction?.promotedPriority ?? -1 },
      now,
    )
    if (config.injectHot ?? true) {
      // 'Early' among the sections (order 10, ahead of the default 100); the base system prompt still comes first.
      const remove = ctx.agentLoop.addSystemSection('memory.hot', async (c) => (await this.hot.render(this.hotView(c.actor))).text || undefined, { order: 10 })
      ctx.effect(() => remove)
    }
  }

  /**
   * What the hot tier shows to `actor` (D-073). Host/main actors see global rules only. A sub-agent sees its own scoped rules,
   * plus global ones if its grant says so. A sub-agent actor with no live grant sees nothing: fail closed.
   */
  hotView(actor: string | undefined): HotView {
    if (!isScopedActor(actor)) return {}
    const g = this.access.get(actor)
    if (!g) return { none: true }
    return { scope: actor, globals: g.hot === 'global' }
  }

  /**
   * A scoped, read-only handle on memory for one actor: the only memory handle a sub-agent should be given. Enforcement point
   * is the model-facing paths (the hot section above) and this view; host code calling `memory.episodic` / `memory.hot`
   * directly is trusted and unrestricted, like the registry's unscoped actors. Any future model-facing memory TOOL must go through here.
   */
  view(actor: string): ScopedMemory {
    const check = () => {
      if (isScopedActor(actor) && !this.access.get(actor)) throw new MemoryError(`memory: "${actor}" has no live memory grant`)
    }
    return {
      actor,
      episodes: async (query = {}) => {
        check()
        return this.episodic.query({ ...query, agentId: actor }) // agentId last: a caller-supplied one cannot win
      },
      hot: async () => {
        check()
        return this.hot.render(this.hotView(actor))
      },
    }
  }

  /**
   * Promote lessons that recur across episodes into the hot tier (3.4). Manual
   * entry point; `compaction.everyTurns` also calls it from `runTurn`.
   * Idempotent. See `Compaction` for the rules.
   */
  compact(opts: { minOccurrences?: number; dryRun?: boolean; approve?: (c: PromotionCandidate) => boolean | Promise<boolean> } = {}): Promise<CompactionResult> {
    return this.compaction.run(opts)
  }

  /**
   * Run one turn through `ctx.agentLoop` and write its episodic entry:
   * exactly one per turn, including `max_steps` and failed turns (a failure is
   * the most useful thing to remember). A failed turn is recorded and the
   * error is rethrown unchanged. 
   */
  async runTurn(opts: RunTaskOptions & { lesson?: string | null }): Promise<RunResult & { episode: Episode }> {
    const loop = this.ctx.agentLoop
    const { lesson, ...runOpts } = opts
    const fromSeq = (await this.ctx.log.resume(opts.sessionId)).nextSeq
    const base = { sessionId: opts.sessionId, ...(opts.actor ? { agentId: opts.actor } : {}), task: opts.prompt, fromSeq }
    let result: RunResult
    try {
      result = await loop.run(runOpts)
    } catch (err) {
      const toSeq = (await this.ctx.log.resume(opts.sessionId)).nextSeq - 1
      if (toSeq >= fromSeq) {
        const msg = err instanceof Error ? err.message : String(err)
        await this.episodic.record({ ...base, toSeq, outcome: 'error', result: msg, ...(lesson !== undefined ? { lesson } : {}) })
      }
      throw err
    }
    const toSeq = (await this.ctx.log.resume(opts.sessionId)).nextSeq - 1
    const { episode, created } = await this.episodic.record({
      ...base,
      toSeq,
      outcome: result.stopReason,
      result: result.finalText,
      steps: result.steps,
      ...(lesson !== undefined ? { lesson } : {}),
    })
    if (created && this.everyTurns !== undefined) {
      // Counted from the stored episodes, not a counter, so the schedule survives a restart.
      const n = (await this.episodic.query({})).length
      if (n % this.everyTurns === 0) await this.autoCompact()
    }
    return { ...result, episode }
  }

  private async autoCompact(): Promise<void> {
    const ts = new Date().toISOString()
    try {
      this.lastCompaction = { ts, result: await this.compaction.run({}) }
    } catch (err) {
      // A memory problem must not fail the user's turn; it is recorded here instead.
      this.lastCompaction = { ts, error: err instanceof Error ? err.message : String(err) }
    }
  }
}

export const name = 'bundle-memory'
export function apply(ctx: Context, config: MemoryConfig = {}) {
  ctx.plugin(Memory, config)
}
