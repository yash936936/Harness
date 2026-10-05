import { Context, Service } from 'cordis'
import '../session-log/index.js'
import '../tool-registry/index.js'
import '../agent-loop/index.js'
import { DEFAULT_LIMITS, extractJson, planSchema, plannerSystem, validatePlan } from './plan.js'
import { executePlan } from './execute.js'
import { OrchestratorError, PlanError, type ExecuteOptions, type ExecutionResult, type OrchestratorConfig, type Plan, type PlanOptions, type PlanResult, type PlannerLimits } from './types.js'

export * from './types.js'
export { validatePlan, extractJson } from './plan.js'

declare module 'cordis' {
  interface Context {
    orchestrator: Orchestrator
  }
}

const ACTOR = 'orchestrator'

/**
 * `ctx.orchestrator` — 4.1, the planning half. `plan()` asks a model for a short list of narrow
 * subtasks, validates it against a schema, and logs it (`plan.created`) before returning. An invalid
 * plan is never returned: the model gets the exact errors and one repair attempt by default, after
 * which `PlanError` is thrown and `plan.rejected` is logged. The planner model is given NO tools
 * (and the registry would refuse any it tried to call, D-068). Execution is 4.2.
 *
 * Designed for weak workers (D-070): small plans, few tools per subtask, earlier-only dependencies
 * (so no cycles), and a strict reply format. It reuses the agent loop for the model call, so
 * retries, fallback providers and logging are the same as everywhere else.
 */
export class Orchestrator extends Service {
  static inject = ['log', 'tools', 'agentLoop']

  private readonly limits: PlannerLimits
  private readonly cfg: OrchestratorConfig
  private readonly maxRetries: number
  private readonly maxResultChars: number

  constructor(ctx: Context, config: OrchestratorConfig = {}) {
    super(ctx, 'orchestrator')
    this.cfg = config
    this.maxRetries = config.maxRetries ?? 3
    this.maxResultChars = config.maxResultChars ?? 2000
    this.limits = {
      maxSubtasks: config.maxSubtasks ?? DEFAULT_LIMITS.maxSubtasks,
      maxToolsPerSubtask: config.maxToolsPerSubtask ?? DEFAULT_LIMITS.maxToolsPerSubtask,
      maxGoalChars: config.maxGoalChars ?? DEFAULT_LIMITS.maxGoalChars,
      maxIdChars: config.maxIdChars ?? DEFAULT_LIMITS.maxIdChars,
    }
    if (this.limits.maxSubtasks < 1 || this.limits.maxToolsPerSubtask < 0) throw new OrchestratorError('orchestrator: invalid planner limits')
  }

  /**
   * Run a plan (4.2). Needs `ctx.subagents`. Failure handling is the D-074 policy: abort by default, opt-in retries
   * and continue. See `executePlan`.
   */
  execute(plan: Plan, opts: ExecuteOptions): Promise<ExecutionResult> {
    return executePlan({ ctx: this.ctx, limits: this.limits, maxRetries: this.maxRetries, maxResultChars: this.maxResultChars }, plan, opts)
  }

  async plan(opts: PlanOptions): Promise<PlanResult> {
    if (!opts.task?.trim()) throw new OrchestratorError('orchestrator: task must be a non-empty string')
    const offered = opts.tools ?? this.ctx.tools.list().map((t) => t.name)
    for (const n of offered) if (!this.ctx.tools.has(n)) throw new OrchestratorError(`orchestrator: tool "${n}" is not registered`)
    const info = offered.map((n) => this.ctx.tools.list().find((t) => t.name === n)!)
    const registered = new Set(offered)
    const system = plannerSystem(info, this.limits)
    const maxRepairs = opts.maxRepairs ?? this.cfg.maxRepairs ?? 1
    const provider = opts.provider ?? this.cfg.provider
    const model = opts.model ?? this.cfg.model
    const schema = (opts.structured ?? this.cfg.structured ?? true) ? planSchema(offered, (this.cfg.schemaLimits ?? true) ? this.limits : undefined) : undefined

    let prompt = opts.task
    let errors: string[] = []
    let attempts = 0
    for (;;) {
      attempts++
      const res = await this.ctx.agentLoop.run({
        sessionId: opts.sessionId,
        actor: ACTOR,
        prompt,
        tools: [],
        system,
        maxSteps: 1,
        ...(schema ? { jsonSchema: schema } : {}),
        ...(provider !== undefined ? { provider } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
      const parsed = extractJson(res.finalText)
      const checked = parsed.ok ? validatePlan(opts.task, parsed.value, registered, this.limits) : { ok: false as const, errors: [parsed.error] }
      if (checked.ok) {
        // Logged BEFORE returning, so the plan is inspectable whatever execution later does.
        await this.ctx.log.append(opts.sessionId, 'plan.created', { plan: checked.plan, attempts, offeredTools: offered }, ACTOR)
        return { plan: checked.plan, attempts }
      }
      errors = checked.errors
      if (attempts > maxRepairs) break
      prompt = [
        opts.task,
        '',
        'Your previous reply was rejected:',
        ...errors.map((e) => `- ${e}`),
        `Previous reply (truncated): ${res.finalText.slice(0, 1500)}`,
        'Reply again with ONLY the corrected JSON object.',
      ].join('\n')
    }
    await this.ctx.log.append(opts.sessionId, 'plan.rejected', { errors, attempts }, ACTOR)
    throw new PlanError(`no valid plan after ${attempts} attempt(s): ${errors.join('; ')}`, errors, attempts)
  }
}

export const name = 'bundle-orchestrator'
export function apply(ctx: Context, config: OrchestratorConfig = {}) {
  ctx.plugin(Orchestrator, config)
}
