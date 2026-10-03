/** Outcome of one agent-loop turn, as recorded in episodic memory. */
export type EpisodeOutcome = 'done' | 'max_steps' | 'error'

/**
 * One episodic entry: what was asked, how it was approached, what came of it
 * and (optionally) what was learned. Exactly one per turn (3.1).
 */
export interface Episode {
  /** `<sessionId>:<fromSeq>` - one turn is one entry, so a repeated write is a no-op. */
  id: string
  sessionId: string
  /** Which agent ran the turn. Defaults to `main`. */
  agentId: string
  /** ISO-8601, assigned when the entry is written. */
  ts: string
  task: string
  /** Deterministic summary of the tools used, from the session log (e.g. `search_code -> read_file x2`). No model call. */
  approach: string
  /** The model's final answer (or the error message for an `error` outcome). */
  result: string
  outcome: EpisodeOutcome
  /** Set only by the caller. Never invented by this bundle (see D-061). */
  lesson: string | null
  /** The session-log events this turn covers, inclusive. */
  fromSeq: number
  toSeq: number
  steps: number
  toolCalls: number
}

export interface RecordTurnInput {
  sessionId: string
  agentId?: string
  task: string
  fromSeq: number
  toSeq: number
  outcome: EpisodeOutcome
  result: string
  steps?: number
  lesson?: string | null
}

export interface EpisodeQuery {
  sessionId?: string
  agentId?: string
  /** Case-insensitive substring of the task text. */
  task?: string
  outcome?: EpisodeOutcome
  /** ISO-8601, inclusive. */
  from?: string
  /** ISO-8601, exclusive. */
  to?: string
  /** Default 'asc' (oldest first). */
  order?: 'asc' | 'desc'
  limit?: number
}

/** Storage backend. Append-only: there is no update or delete. */
export interface EpisodeStore {
  /** Returns false (and writes nothing) when an entry with this id already exists. */
  add(episode: Episode): Promise<boolean>
  all(): Promise<Episode[]>
}

/** One always-loaded rule or fact. */
export interface HotEntry {
  /** Caller-chosen or generated. Adding an existing id replaces that entry. */
  id: string
  text: string
  /** Higher survives trimming longer. Default 0. */
  priority: number
  ts: string
  /** Where it came from (`user`, `compaction`, ...). Free text. */
  source?: string
}

export interface HotRender {
  /** The text to inject. '' when nothing is stored (then nothing is injected, not even the header). */
  text: string
  /** Estimated tokens of `text`, header included. Never above the cap. */
  tokens: number
  included: string[]
  /** Entries that did not fit. They stay stored; they just are not shown. */
  dropped: string[]
}

export interface MemoryConfig {
  /** Directory for `episodic.jsonl` and `hot.json`. Omit to keep memory in-process. */
  path?: string
  /** Hot-tier cap in estimated tokens, header included. Default 2000. */
  hotTokenCap?: number
  /** Token estimate. Default: ceil(chars / 3). There is no tokenizer in this project (D-062). */
  estimateTokens?: (text: string) => number
  /** Add the hot tier to every agent run's system prompt. Default true. */
  injectHot?: boolean
  compaction?: CompactionConfig
  /** Longest stored task / result / approach text. Default 2000 chars. */
  maxFieldChars?: number
  /** Injectable clock for tests. */
  now?: () => Date
}

/**
 * A semantic-tier fact (3.3): something about the architecture or the project
 * that is NOT easy to reconstruct from the code. Unlike an {@link Episode}
 * (an append-only record of a turn) a fact is curated: it can be replaced by
 * id or removed, and it is found by meaning, not by session or time.
 */
export interface SemanticFact {
  /** Distinguishes it from an episodic entry in any mixed listing. */
  tier: 'semantic'
  id: string
  text: string
  /**
   * Why this is worth storing: what makes it non-trivial to reconstruct from the
   * code (a decision's reason, a cross-file invariant, an outside constraint).
   * Required. This is the guard against filing things the code already says (D-063).
   */
  why: string
  tags?: string[]
  /** Where it came from (`user`, a doc path, ...). Free text. */
  source?: string
  ts: string
  updatedTs?: string
}

export interface SemanticHit {
  fact: SemanticFact
  /** Cosine similarity of the query to the fact text. Higher is better. */
  score: number
}

export type SemanticFailure = { ok: false; error: { kind: string; detail: string } }

export interface SemanticConfig {
  /** Directory for `semantic.json` (the facts themselves). Omit to keep facts in-process. */
  path?: string
  /** Vector collection holding the search index. Default `memory-semantic`. */
  collection?: string
  /** Default 1000 chars. */
  maxTextChars?: number
  /** Default 500 chars. */
  maxWhyChars?: number
  now?: () => Date
}

export interface CompactionConfig {
  /** A lesson must appear in at least this many episodes to be promoted. Default 3. */
  minOccurrences?: number
  /** Run compaction automatically after every Nth episode written by `runTurn`. Omit for manual `compact()` only. */
  everyTurns?: number
  /** Hot-tier priority of promoted rules. Default -1: below anything the owner adds (default 0), so promotion can never push a curated rule out. */
  promotedPriority?: number
}

export interface PromotionCandidate {
  /** Hot-tier id the rule is/would be stored under (`lesson-<hash of the normalised lesson>`). */
  id: string
  /** The lesson as worded in its most recent episode. */
  text: string
  /** How many episodes carry this lesson. */
  occurrences: number
  /** Distinct sessions those episodes came from. */
  sessions: number
}

export interface CompactionResult {
  examined: number
  /** Written to the hot tier by this run (or, with `dryRun`, what would have been). */
  promoted: PromotionCandidate[]
  skipped: {
    /** Recurring lessons already promoted before (a rule the owner removed stays removed). */
    alreadyPromoted: number
    /** Lessons seen fewer than `minOccurrences` times. */
    belowThreshold: number
    /** Recurring lessons `approve` said no to. Not remembered: they are asked about again next run. */
    rejected: number
  }
  /** Recurring lessons that could not be stored (e.g. too large for the hot tier). Retried next run. */
  failed: { id: string; reason: string }[]
  dryRun: boolean
}

export class MemoryError extends Error {
  override name = 'MemoryError'
}
