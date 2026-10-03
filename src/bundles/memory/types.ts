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

export interface MemoryConfig {
  /** Directory for `episodic.jsonl`. Omit to keep memory in-process. */
  path?: string
  /** Longest stored task / result / approach text. Default 2000 chars. */
  maxFieldChars?: number
  /** Injectable clock for tests. */
  now?: () => Date
}

export class MemoryError extends Error {
  override name = 'MemoryError'
}
