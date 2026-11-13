// Governed coding-task CLI lifecycle; sandbox execution remains disabled under D-110.
import { statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { Context } from 'cordis'
import { bootProfileCoding, type ProfileCodingConfig } from '../profiles/profile-coding.js'
import type { WizardIO } from './io.js'
import { FileConsentStore } from '../bundles/egress/store.js'
import { COMMAND_TOOL } from '../bundles/tools-local/index.js'
import { LIST_TOOL, SEARCH_TOOL } from '../bundles/retrieval-tools/index.js'
import type { ApprovalRequest } from '../bundles/policy-gates/index.js'

export type CodeProvider = 'ollama' | 'openrouter'
export interface CodeTaskOptions {
  task: string
  projectRoot?: string
  projectId?: string
  provider: CodeProvider
  model: string
  baseUrl?: string
  /** Per-model inference timeout in milliseconds. Ollama defaults to 120 seconds. */
  timeoutMs?: number
  /** Opt in to strict recovery of JSON tool calls emitted as Ollama text. */
  textToolCalls?: boolean
  /** D-110: command execution remains disabled until an explicit superseding decision. */
  sandbox?: 'none'
}
export interface CodeTaskResult { ok: boolean; sessionId?: string; context?: Context; reason?: string }

const safeProjectId = (value: string) => value.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 80) || 'project'

/** Parse an optional positive integer timeout supplied in milliseconds. */
export function parseTimeoutMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const timeoutMs = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 4_294_967_295) {
    throw new RangeError('--timeout-ms must be an integer from 1 to 4294967295 milliseconds')
  }
  return timeoutMs
}

export async function runCodeTask(io: WizardIO, options: CodeTaskOptions): Promise<CodeTaskResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd())
  let projectStat: ReturnType<typeof statSync>
  try {
    projectStat = statSync(projectRoot)
  } catch {
    const reason = `project root does not exist or cannot be accessed: ${projectRoot}`
    io.print(reason)
    return { ok: false, reason }
  }
  if (!projectStat.isDirectory()) {
    const reason = `project root is not a directory: ${projectRoot}`
    io.print(reason)
    return { ok: false, reason }
  }
  if (!options.task.trim()) {
    io.print('task is empty')
    return { ok: false, reason: 'task is empty' }
  }

  const projectId = safeProjectId(options.projectId ?? basename(projectRoot))
  const stateDir = join(projectRoot, '.harness')
  const sessionDir = join(stateDir, 'sessions')

  let openRouterHost: string | undefined
  if (options.provider === 'openrouter') {
    if (!process.env.OPENROUTER_API_KEY) {
      io.print('BLOCKED-KEY: OPENROUTER_API_KEY is not set. Set it in the environment; never pass it as a CLI argument.')
      return { ok: false, reason: 'OPENROUTER_API_KEY is not set' }
    }
    try {
      const endpoint = new URL(options.baseUrl ?? 'https://openrouter.ai/api/v1')
      if (endpoint.protocol !== 'https:' || !endpoint.hostname || endpoint.username || endpoint.password) {
        throw new Error('expected an HTTPS URL without embedded credentials')
      }
      openRouterHost = endpoint.hostname
    } catch (error) {
      const reason = `invalid OpenRouter endpoint: ${error instanceof Error ? error.message : String(error)}`
      io.print(reason)
      return { ok: false, reason }
    }
    io.print(`This run sends prompts, selected project content, and OPENROUTER_API_KEY to ${openRouterHost}.`)
    if (!(await io.confirm(`Allow this project to send data and its OpenRouter API key to ${openRouterHost}?`, { default: false }))) {
      io.print('Remote provider consent was not granted; no request was sent.')
      return { ok: false, reason: 'remote egress consent declined' }
    }
  }

  const approver = async (request: ApprovalRequest) => {
    io.print('')
    io.print(`APPROVAL REQUEST ${request.id}`)
    io.print(`Tool: ${request.tool} (${request.class})`)
    io.print(`Reason: ${request.reason}`)
    io.print(`Input: ${JSON.stringify(request.input)}`)
    const approve = await io.confirm('Approve this exact operation?', { default: false })
    return { approve, by: 'terminal', note: approve ? 'approved in terminal' : 'denied in terminal' }
  }

  const modelAdapter: NonNullable<ProfileCodingConfig['modelAdapter']> = options.provider === 'openrouter'
    ? {
        openaiCompatible: {
          name: 'openrouter',
          model: options.model,
          baseUrl: options.baseUrl ?? 'https://openrouter.ai/api/v1',
          apiKeyEnv: 'OPENROUTER_API_KEY',
        },
        default: 'openrouter',
        egress: { consent: true },
        rateLimit: { perMinute: 16, perDay: 50, maxConcurrent: 1, statePath: join(stateDir, 'openrouter-rate.json'), provider: 'openrouter' },
      }
    : {
        ollama: {
          model: options.model,
          ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
          ...(options.textToolCalls === true ? { textToolCalls: true } : {}),
        },
        default: 'ollama',
      }

  const config: ProfileCodingConfig = {
    projectId,
    projectRoot,
    sessionLog: { path: sessionDir },
    modelAdapter,
    egress: {
      allowedHosts: openRouterHost ? [openRouterHost] : [],
      consentStore: new FileConsentStore(join(stateDir, 'consent.json')),
    },
    agentLoop: { maxSteps: 8, reflection: false },
    orchestrator: { maxSubtasks: 8, maxToolsPerSubtask: 3, maxRepairs: 1 },
    policy: { approvalTimeoutMs: 120000, approver },
  }

  let ctx: Context | undefined
  try {
    ctx = await bootProfileCoding(config)
    const sessionId = ctx.log.create()
    // D-110 is a hard prohibition: do not perform host-environment capability checks.
    const hostProcessTools = new Set([COMMAND_TOOL, SEARCH_TOOL, LIST_TOOL])
    const offeredTools = ctx.tools.list().map((tool) => tool.name).filter((name) => !hostProcessTools.has(name))
    io.print('no sandbox: commands disabled, file tools still gated')
    await ctx.log.append(sessionId, 'sandbox.unavailable', {
      reason: 'sandbox probing and command execution disabled under D-110; no host fallback',
    }, 'cli')

    await ctx.log.append(sessionId, 'code.started', {
      projectRoot,
      provider: options.provider,
      model: options.model,
      sandbox: 'none',
      offeredTools,
    }, 'cli')
    io.print(`Session: ${sessionId}`)
    io.print(`Project: ${projectRoot}`)
    io.print(`Provider: ${options.provider} / ${options.model}`)
    io.print(`Tools offered: ${offeredTools.join(', ')}`)

    if (options.provider === 'openrouter') await ctx.egress.grantConsent()
    const plan = await ctx.orchestrator.plan({
      sessionId,
      task: options.task,
      tools: offeredTools,
      provider: options.provider === 'ollama' ? 'ollama' : 'openrouter',
      model: options.model,
    })
    await ctx.log.append(sessionId, 'code.plan.accepted', { attempts: plan.attempts, subtasks: plan.plan.subtasks.length }, 'cli')
    io.print(`Plan accepted (${plan.attempts} planner call(s), ${plan.plan.subtasks.length} subtask(s)).`)

    const result = await ctx.orchestrator.execute(plan.plan, {
      sessionId,
      allowedTools: offeredTools,
      provider: options.provider === 'ollama' ? 'ollama' : 'openrouter',
      model: options.model,
      retries: 0,
    })
    await ctx.log.append(sessionId, 'code.finished', {
      status: result.status,
      aborted: result.aborted,
      audit: result.audit,
      subtasks: result.subtasks.map(({ id, status, attempts, reason }) => ({
        id, status, attempts, ...(reason ? { reason } : {}),
      })),
    }, 'cli')
    for (const item of result.subtasks) {
      io.print(`${item.id}: ${item.status}${item.reason ? ` (${item.reason})` : ''}`)
    }
    io.print(`Session log: ${join(sessionDir, sessionId + '.jsonl')}`)
    if (!result.audit.complete) io.print(`AUDIT INCOMPLETE: ${result.audit.missing.join(', ')}`)
    return { ok: result.status === 'completed' && result.audit.complete, sessionId, context: ctx }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    io.print(`Code task failed: ${reason}`)
    return { ok: false, context: ctx, reason }
  }
}
