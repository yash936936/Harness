import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { Context } from 'cordis'
import { bootProfileCoding, type ProfileCodingConfig } from '../profiles/profile-coding.js'
import type { WizardIO } from './io.js'
import { FileConsentStore } from '../bundles/egress/store.js'
import { COMMAND_TOOL } from '../bundles/tools-local/index.js'
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
  sandbox?: 'auto' | 'none'
  dockerAvailable?: boolean
}
export interface CodeTaskResult { ok: boolean; sessionId?: string; context?: Context; reason?: string }

export function dockerEngineAvailable(): boolean {
  const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    timeout: 4000, windowsHide: true, stdio: 'ignore', shell: false, env: process.env,
  })
  return result.status === 0 && !result.error
}

const safeProjectId = (value: string) => value.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 80) || 'project'

/** Parse an optional positive integer timeout supplied in milliseconds. */
export function parseTimeoutMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const timeoutMs = Number(value)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('--timeout-ms must be a positive integer (milliseconds)')
  }
  return timeoutMs
}

export async function runCodeTask(io: WizardIO, options: CodeTaskOptions): Promise<CodeTaskResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd())
  if (!existsSync(projectRoot)) {
    const reason = `project root does not exist: ${projectRoot}`
    io.print(reason)
    return { ok: false, reason }
  }
  if (!options.task.trim()) {
    io.print('task is empty')
    return { ok: false, reason: 'task is empty' }
  }

  const projectId = safeProjectId(options.projectId ?? basename(projectRoot))
  const stateDir = join(projectRoot, '.harness')
  mkdirSync(stateDir, { recursive: true })
  const sessionDir = join(stateDir, 'sessions')
  const sandboxDetected = options.sandbox !== 'none' && (options.dockerAvailable ?? dockerEngineAvailable())

  if (options.provider === 'openrouter') {
    if (!process.env.OPENROUTER_API_KEY) {
      io.print('BLOCKED-KEY: OPENROUTER_API_KEY is not set. Set it in the environment; never pass it as a CLI argument.')
      return { ok: false, reason: 'OPENROUTER_API_KEY is not set' }
    }
    io.print('OpenRouter sends prompts and selected project content to openrouter.ai.')
    if (!(await io.confirm('Allow this project to send data to OpenRouter?', { default: false }))) {
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
        },
        default: 'ollama',
      }

  const config: ProfileCodingConfig = {
    projectId,
    projectRoot,
    sessionLog: { path: sessionDir },
    modelAdapter,
    egress: {
      allowedHosts: options.provider === 'openrouter' ? ['openrouter.ai'] : [],
      consentStore: new FileConsentStore(join(stateDir, 'consent.json')),
    },
    agentLoop: { maxSteps: 8, reflection: false },
    orchestrator: { maxSubtasks: 8, maxToolsPerSubtask: 3, maxRepairs: 1 },
    policy: { approvalTimeoutMs: 120000, approver },
    sandbox: sandboxDetected
      ? { crabbox: { provider: 'local-container', runtime: 'docker', cwd: projectRoot }, default: 'crabbox' }
      : undefined,
  }

  let ctx: Context | undefined
  try {
    ctx = await bootProfileCoding(config)
    const sessionId = ctx.log.create()
    let sandboxReady = false
    if (sandboxDetected) {
      const doctor = (await ctx.sandbox.doctor()).crabbox
      sandboxReady = doctor?.ok === true
      io.print(sandboxReady
        ? `Sandbox: Crabbox local-container ready (${doctor?.detail ?? 'ready'})`
        : `Crabbox doctor failed: ${doctor?.detail ?? 'no doctor result'}`)
    }
    const offeredTools = ctx.tools.list().map((tool) => tool.name).filter((name) => sandboxReady || name !== COMMAND_TOOL)
    if (!sandboxReady) {
      io.print('no sandbox: commands disabled, file tools still gated')
      await ctx.log.append(sessionId, 'sandbox.unavailable', {
        reason: sandboxDetected ? 'Crabbox doctor failed; no host fallback' : 'Docker unavailable or sandbox disabled; no host fallback',
      }, 'cli')
    }

    await ctx.log.append(sessionId, 'code.started', {
      projectRoot,
      provider: options.provider,
      model: options.model,
      sandbox: sandboxReady ? 'crabbox-local-container' : 'none',
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
