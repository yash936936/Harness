import type { RunResult, RunTaskOptions } from '../agent-loop/index.js'
import type { Episode, MemoryGrant, ScopedMemory } from '../memory/index.js'

export interface SubagentSpec {
  /** 1-64 of [A-Za-z0-9_-]. Becomes the actor `subagent:<id>` on every log event the agent causes. */
  id: string
  /** Session the spawn is logged under, and the default session for `run`. */
  sessionId: string
  /** The ONLY tools this agent may call. Every name must be registered at spawn time. */
  tools: string[]
  /** Spawn as a child of this live sub-agent: the grant must be a subset of the parent's. */
  parent?: string
  system?: string
  maxSteps?: number
  /** Memory this agent may see (D-073). Default `{ hot: 'global' }`: its own episodes and scoped rules, plus global hot rules. Ignored when the memory bundle is not loaded. */
  memory?: MemoryGrant
}

export type SubagentRunOptions = Omit<RunTaskOptions, 'actor' | 'sessionId' | 'tools' | 'prompt'> & {
  sessionId?: string
  /** Recorded on this run's episode when memory is loaded (see `Memory.runTurn`). */
  lesson?: string | null
  /** May only NARROW the grant. Naming a tool outside it throws `ScopeError`. */
  tools?: string[]
}

export interface SubAgent {
  readonly id: string
  readonly actor: string
  readonly tools: readonly string[]
  readonly parent?: string
  readonly closed: boolean
  /** This agent's scoped view of memory; `undefined` when the memory bundle is not loaded. */
  readonly memory: ScopedMemory | undefined
  /** With memory loaded, the run is recorded as an episode under this agent's own id. */
  run(prompt: string, opts?: SubagentRunOptions): Promise<RunResult & { episode?: Episode }>
  close(): Promise<void>
}

/** Misuse of a scope: bad id, duplicate, ungranted or unregistered tool, widening a grant, running a closed agent. */
export class ScopeError extends Error {
  override name = 'ScopeError'
}
