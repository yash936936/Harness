import type { MemoryGrant } from '../memory/index.js'

export interface Subtask {
  /** Unique within the plan. */
  id: string
  /** One narrow, self-contained goal. */
  goal: string
  /** Registered tools this subtask may need. Advisory input for 4.2/4.3; never a grant by itself. */
  tools: string[]
  /** Ids of EARLIER subtasks whose results this one needs. Earlier-only, so a plan cannot contain a cycle. */
  dependsOn: string[]
}

export interface Plan {
  task: string
  subtasks: Subtask[]
}

export interface PlannerLimits {
  /** Default 8: a weak worker (D-070) does not get long plans. */
  maxSubtasks: number
  /** Default 3: few tools per subtask. */
  maxToolsPerSubtask: number
  maxGoalChars: number
  maxIdChars: number
}

export interface PlanOptions {
  sessionId: string
  task: string
  /** Tools the planner may assign to subtasks. Default: every registered tool. Must all be registered. */
  tools?: string[]
  provider?: string
  model?: string
  /** Extra attempts after the first, each told exactly what was wrong. Default 1. */
  maxRepairs?: number
  /** Ask the provider to constrain output to the plan schema. Default true; set false to measure the unconstrained model. */
  structured?: boolean
  signal?: AbortSignal
}

export interface PlanResult {
  plan: Plan
  /** Model calls used (1 = accepted first time). */
  attempts: number
}

export interface OrchestratorConfig extends Partial<PlannerLimits> {
  /** Put the array-size limits (subtask count, tools per subtask) in the plan schema too. Default true. Set false if a provider rejects `maxItems`. */
  schemaLimits?: boolean
  /** Upper bound for `ExecuteOptions.retries`. Default 3. */
  maxRetries?: number
  /** Each dependency result passed on to a later subtask is cut to this many characters. Default 2000. */
  maxResultChars?: number
  provider?: string
  model?: string
  maxRepairs?: number
  structured?: boolean
}

export type SubtaskStatus = 'completed' | 'failed' | 'blocked' | 'not-run'

export interface ExecuteOptions {
  sessionId: string
  /**
   * The ceiling on tools any subtask may be granted. Required and explicit: a plan is model output, so what it asks for is
   * never what it gets by itself. Every tool a subtask lists must be inside this list (checked for the WHOLE plan before
   * anything runs), and each subtask's sub-agent is granted exactly the tools it lists, no more.
   */
  allowedTools: string[]
  /** D-074. `abort` (default) stops at the first failure; `continue` runs independent subtasks and blocks the failed one's dependents. */
  onFailure?: 'abort' | 'continue'
  /** D-074. Extra attempts per failed subtask (default 0, at most `maxRetries`). Only attempted if the failed attempt made no side-effecting tool call. */
  retries?: number
  system?: string
  maxSteps?: number
  provider?: string
  model?: string
  memory?: MemoryGrant
  /** Tags this run's sub-agent ids and log events. Default: a random `r…` tag. 1-20 of [A-Za-z0-9_-]. */
  runId?: string
  signal?: AbortSignal
}

export interface SubtaskResult {
  id: string
  goal: string
  status: SubtaskStatus
  /** Runs actually made (0 for blocked / not-run). */
  attempts: number
  /** The subtask's final answer (completed only). */
  text?: string
  steps?: number
  /** Why it failed (failed only). */
  reason?: string
  /** The unfinished subtasks it depended on (blocked only). */
  blockedBy?: string[]
}

export interface ExecutionResult {
  runId: string
  /** `completed` only if every subtask completed. */
  status: 'completed' | 'failed'
  /** True if the run stopped early (abort policy, or the signal fired) rather than running everything it could. */
  aborted: boolean
  /** One entry per plan subtask, in plan order. None is ever left without a terminal status. */
  subtasks: SubtaskResult[]
  /** The answers of the completed subtasks, by id. */
  outputs: Record<string, string>
}

/** Misuse (empty task, unregistered tool offered). Never a model outcome. */
export class OrchestratorError extends Error {
  override name = 'OrchestratorError'
}

/** The model never produced a valid plan. Nothing was executed; `plan.rejected` is in the log. */
export class PlanError extends Error {
  override name = 'PlanError'
  constructor(message: string, readonly errors: string[], readonly attempts: number) {
    super(message)
  }
}
