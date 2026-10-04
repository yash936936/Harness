import type { RunResult, RunTaskOptions } from '../agent-loop/index.js'

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
}

export type SubagentRunOptions = Omit<RunTaskOptions, 'actor' | 'sessionId' | 'tools' | 'prompt'> & {
  sessionId?: string
  /** May only NARROW the grant. Naming a tool outside it throws `ScopeError`. */
  tools?: string[]
}

export interface SubAgent {
  readonly id: string
  readonly actor: string
  readonly tools: readonly string[]
  readonly parent?: string
  readonly closed: boolean
  run(prompt: string, opts?: SubagentRunOptions): Promise<RunResult>
  close(): Promise<void>
}

/** Misuse of a scope: bad id, duplicate, ungranted or unregistered tool, widening a grant, running a closed agent. */
export class ScopeError extends Error {
  override name = 'ScopeError'
}
