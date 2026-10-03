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
  /** Longest stored task / result / approach text. Default 2000 chars. */
  maxFieldChars?: number
  /** Injectable clock for tests. */
  now?: () => Date
}

export class MemoryError extends Error {
  override name = 'MemoryError'
}
