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
  signal?: AbortSignal
}

export interface PlanResult {
  plan: Plan
  /** Model calls used (1 = accepted first time). */
  attempts: number
}

export interface OrchestratorConfig extends Partial<PlannerLimits> {
  provider?: string
  model?: string
  maxRepairs?: number
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
