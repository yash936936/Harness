import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EpisodicMemory } from './index.js'
import type { HotTier } from './hot.js'
import { MemoryError, type CompactionResult, type PromotionCandidate } from './types.js'

/** Same lesson = same text after lower-casing, collapsing whitespace and trimming edge punctuation. */
export function normaliseLesson(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/^[\s.,;:!?'"()-]+|[\s.,;:!?'"()-]+$/g, '')
}
export function lessonId(normalised: string): string {
  return 'lesson-' + createHash('sha1').update(normalised).digest('hex').slice(0, 16)
}

interface Ledger {
  promoted: Record<string, { ts: string; occurrences: number; text: string }>
}

/**
 * Compaction (3.4): promotes lessons that recur across episodes into the hot
 * tier, so the memory improves instead of only growing.
 *
 * - "Same lesson" is exact after normalisation. Lessons are caller-supplied
 *   (D-061); there is no embedding of episodes, so no fuzzy matching.
 * - No model call: the promoted rule is the lesson's own wording.
 * - Idempotent: a rule is promoted once. A ledger (`compaction.json`) remembers
 *   what was promoted, so a rule the owner later deletes is not re-added.
 * - Promoted rules carry `source: 'compaction'` and a low priority.
 * - It writes into every future system prompt, so a lesson that was poisoned
 *   (written by a compromised model or document) would become a standing
 *   instruction after enough repeats. `dryRun` and `approve` exist for that
 *   reason; the default still promotes automatically (D-064).
 */
export class Compaction {
  private ledger: Ledger | undefined
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private episodic: EpisodicMemory,
    private hot: HotTier,
    private dir: string | undefined,
    private defaults: { minOccurrences: number; promotedPriority: number },
    private now: () => Date,
  ) {
    if (!Number.isInteger(defaults.minOccurrences) || defaults.minOccurrences < 2) {
      throw new MemoryError('memory: compaction minOccurrences must be an integer >= 2 (a lesson seen once is not a pattern)')
    }
    if (!Number.isFinite(defaults.promotedPriority)) throw new MemoryError('memory: compaction promotedPriority must be finite')
  }

  /** Serialised, so two overlapping runs cannot both promote the same lesson. */
  run(opts: { minOccurrences?: number; dryRun?: boolean; approve?: (c: PromotionCandidate) => boolean | Promise<boolean> } = {}): Promise<CompactionResult> {
    const job = this.queue.then(() => this.runNow(opts))
    this.queue = job.catch(() => {})
    return job
  }

  private async runNow(opts: { minOccurrences?: number; dryRun?: boolean; approve?: (c: PromotionCandidate) => boolean | Promise<boolean> }): Promise<CompactionResult> {
    const min = opts.minOccurrences ?? this.defaults.minOccurrences
    if (!Number.isInteger(min) || min < 2) throw new MemoryError('memory: minOccurrences must be an integer >= 2')
    const dryRun = opts.dryRun === true
    const episodes = await this.episodic.query({}) // oldest first
    const groups = new Map<string, { text: string; occurrences: number; sessions: Set<string> }>()
    for (const e of episodes) {
      if (!e.lesson) continue
      const key = normaliseLesson(e.lesson)
      if (!key) continue
      const g = groups.get(key) ?? { text: e.lesson, occurrences: 0, sessions: new Set<string>() }
      g.text = e.lesson // keep the most recent wording
      g.occurrences++
      g.sessions.add(e.sessionId)
      groups.set(key, g)
    }

    const ledger = await this.loadLedger()
    const inHot = new Set((await this.hot.list()).map((h) => h.id))
    const result: CompactionResult = { examined: episodes.length, promoted: [], skipped: { alreadyPromoted: 0, belowThreshold: 0, rejected: 0 }, failed: [], dryRun }

    for (const [key, g] of groups) {
      if (g.occurrences < min) {
        result.skipped.belowThreshold++
        continue
      }
      const id = lessonId(key)
      if (ledger.promoted[key]) {
        result.skipped.alreadyPromoted++
        continue
      }
      const candidate: PromotionCandidate = { id, text: g.text, occurrences: g.occurrences, sessions: g.sessions.size }
      if (inHot.has(id)) {
        // In the hot tier but missing from the ledger (e.g. a crash between the two writes): adopt it, write nothing to the hot tier.
        if (!dryRun) await this.record(key, candidate)
        result.skipped.alreadyPromoted++
        continue
      }
      if (opts.approve && !(await opts.approve(candidate))) {
        result.skipped.rejected++
        continue
      }
      if (dryRun) {
        result.promoted.push(candidate)
        continue
      }
      try {
        await this.hot.add({ id, text: g.text, priority: this.defaults.promotedPriority, source: 'compaction' })
      } catch (err) {
        result.failed.push({ id, reason: err instanceof Error ? err.message : String(err) })
        continue
      }
      await this.record(key, candidate)
      result.promoted.push(candidate)
    }
    return result
  }

  // ---- ledger -----------------------------------------------------------------------------------

  private get file() {
    return join(this.dir!, 'compaction.json')
  }

  private async loadLedger(): Promise<Ledger> {
    if (this.ledger) return this.ledger
    this.ledger = { promoted: {} }
    if (this.dir) {
      try {
        const parsed = JSON.parse(await readFile(this.file, 'utf8'))
        if (!parsed || typeof parsed.promoted !== 'object') throw new Error('unexpected shape')
        this.ledger = parsed
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          this.ledger = undefined
          throw new MemoryError(`memory: compaction.json is unreadable (${err?.message ?? err}); refusing to overwrite it`)
        }
      }
    }
    return this.ledger!
  }

  private async record(key: string, c: PromotionCandidate): Promise<void> {
    const ledger = await this.loadLedger()
    const next: Ledger = { promoted: { ...ledger.promoted, [key]: { ts: this.now().toISOString(), occurrences: c.occurrences, text: c.text } } }
    if (this.dir) {
      await mkdir(this.dir, { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
      await rename(tmp, this.file)
    }
    this.ledger = next
  }
}
