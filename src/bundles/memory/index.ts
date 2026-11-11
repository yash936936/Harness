// Memory service: composes episodic, hot, and optional semantic memory tiers.
import { Context, Service } from 'cordis'
import type { RunResult, RunTaskOptions } from '../agent-loop/index.js'
import { EpisodicMemory } from './episodic.js'
import { JsonlEpisodeStore, MemoryEpisodeStore } from './store.js'
import { HotTier, defaultEstimateTokens } from './hot.js'
import { Compaction } from './compaction.js'
import { deriveLesson } from './derive.js'
import {
  MemoryError,
  type Episode,
  type CompactionResult,
  type MemoryConfig,
  type HotView,
  type PromotionCandidate,
  type ScopedMemory,
} from './types.js'
import { MemoryAccess, isScopedActor } from './access.js'
import type { MemorySemantic } from './semantic.js'

export * from './types.js'
export { EpisodicMemory, summariseApproach } from './episodic.js'
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
  private semanticService: MemorySemantic | undefined
  private readonly compaction: Compaction
  private readonly everyTurns: number | undefined
  private readonly deriveLessons: boolean
  /** The most recent automatic compaction (3.4): its result, or the error that stopped it. Never thrown into a user's turn. */
  lastCompaction: { ts: string; result?: CompactionResult; error?: string } | undefined

  constructor(ctx: Context, config: MemoryConfig = {}) {
    super(ctx, 'memory')
    const store = config.path ? new JsonlEpisodeStore(config.path) : new MemoryEpisodeStore()
    const now = config.now ?? (() => new Date())
    const maxFieldChars = config.maxFieldChars ?? DEFAULT_MAX_CHARS
    if (!Number.isSafeInteger(maxFieldChars) || maxFieldChars < 1) throw new MemoryError('memory: maxFieldChars must be a positive safe integer')
    this.episodic = new EpisodicMemory(store, ctx, maxFieldChars, now)
    this.hot = new HotTier(ctx, config.path, config.hotTokenCap ?? DEFAULT_HOT_CAP, config.estimateTokens ?? defaultEstimateTokens, now)
    this.everyTurns = config.compaction?.everyTurns
    this.deriveLessons = config.deriveLessons ?? false
    if (this.everyTurns !== undefined && (!Number.isSafeInteger(this.everyTurns) || this.everyTurns < 1)) throw new MemoryError('memory: compaction.everyTurns must be a positive safe integer')
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
      if (isScopedActor(actor) && !this.access.get(actor)) {
        throw new MemoryError(`memory: "${actor}" has no live memory grant`)
      }
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

  /** Attach the optional semantic service after its dependencies have been loaded. */
  setSemanticService(service: MemorySemantic): void {
    this.semanticService = service
  }

  /** Search the semantic tier for this actor. Results are always revalidated against the actor grant. */
  async querySemantic(actor: string | undefined, text: string, opts: { k?: number; minScore?: number; maxChars?: number } = {}) {
    if (isScopedActor(actor)) {
      if (!this.access.get(actor)) throw new MemoryError(`memory: "${actor}" has no live memory grant`)
      if (!this.access.canQuerySemantic(actor)) throw new MemoryError(`memory: "${actor}" has no semantic-memory grant`)
    }
    const semantic = this.semanticService
    if (!semantic) throw new MemoryError('memory: semantic retrieval is not configured')
    const k = Math.min(opts.k ?? 5, 8)
    if (!Number.isInteger(k) || k < 1) throw new MemoryError('memory: semantic retrieval k must be between 1 and 8')
    const maxChars = Math.min(opts.maxChars ?? 2400, 4000)
    if (!Number.isInteger(maxChars) || maxChars < 1) throw new MemoryError('memory: semantic retrieval maxChars must be between 1 and 4000')
    const result = await semantic.query(text, { k, ...(opts.minScore !== undefined ? { minScore: opts.minScore } : {}) })
    if (!result.ok) throw new MemoryError(`memory: semantic retrieval failed (${result.error.kind})`)
    const hits = []
    let used = 0
    for (const hit of result.hits) {
      const fact = hit.fact
      if (!fact.source || !fact.source.trim()) continue
      const body = `[semantic id=${fact.id} source=${fact.source} score=${hit.score.toFixed(3)}] ${fact.text} Why: ${fact.why}`
      if (used + body.length > maxChars) continue
      hits.push({ id: fact.id, source: fact.source, score: hit.score, text: body })
      used += body.length
    }
    return { hits, stale: result.stale, chars: used }
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
    const { lesson: given, ...runOpts } = opts
    const fromSeq = (await this.ctx.log.resume(opts.sessionId)).nextSeq
    const base = { sessionId: opts.sessionId, ...(opts.actor ? { agentId: opts.actor } : {}), task: opts.prompt, fromSeq }
    let result: RunResult
    try {
      result = await loop.run(runOpts)
    } catch (err) {
      const toSeq = (await this.ctx.log.resume(opts.sessionId)).nextSeq - 1
      if (toSeq >= fromSeq) {
        const lesson = await this.lessonFor(opts.sessionId, fromSeq, toSeq, given)
        const msg = err instanceof Error ? err.message : String(err)
        await this.episodic.record({ ...base, toSeq, outcome: 'error', result: msg, ...(lesson !== undefined ? { lesson } : {}) })
      }
      throw err
    }
    const toSeq = (await this.ctx.log.resume(opts.sessionId)).nextSeq - 1
    const lesson = await this.lessonFor(opts.sessionId, fromSeq, toSeq, given)
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

  /** The caller's lesson wins (even an explicit `null`); otherwise, if enabled, one templated from the turn's log (D-083). */
  private async lessonFor(sessionId: string, fromSeq: number, toSeq: number, given: string | null | undefined): Promise<string | null | undefined> {
    if (given !== undefined) return given
    if (!this.deriveLessons) return undefined
    return deriveLesson(await this.ctx.log.read(sessionId), fromSeq, toSeq)
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
