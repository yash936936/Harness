import { Context } from 'cordis'
import { isAbsolute } from 'node:path'
import { SessionLog, type SessionLogConfig } from '../bundles/session-log/index.js'
import { EgressPolicy, type EgressConfig } from '../bundles/egress/index.js'
import { LLMService, type ModelAdapterConfig } from '../bundles/model-adapter/index.js'
import { ToolRegistry, type ToolRegistryConfig } from '../bundles/tool-registry/index.js'
import { Subprocess, type SubprocessConfig } from '../bundles/subprocess/index.js'
import { AgentLoop, type AgentLoopConfig } from '../bundles/agent-loop/index.js'
import { SubagentScope } from '../bundles/subagent-scope/index.js'
import { PolicyGates, CONFIDENCE_FIELD, type PolicyConfig } from '../bundles/policy-gates/index.js'
import { InputGuard, type InputGuardConfig } from '../bundles/input-guard/index.js'
import { Memory, type MemoryConfig } from '../bundles/memory/index.js'
import { RetrievalGrep, type RetrievalGrepConfig } from '../bundles/retrieval-grep/index.js'
import { RetrievalTreesitter, type RetrievalTreesitterConfig } from '../bundles/retrieval-treesitter/index.js'
import { RetrievalRank, type RetrievalRankConfig } from '../bundles/retrieval-rank/index.js'
import { RetrievalTools, type RetrievalToolsConfig } from '../bundles/retrieval-tools/index.js'
import { Embeddings, type EmbeddingsConfig } from '../bundles/embeddings/index.js'
import { LanceVectorStore, type VectorStoreConfig } from '../bundles/vectorstore-lancedb/index.js'
import { Skills, type SkillsConfig } from '../bundles/skills/index.js'
import { Orchestrator, type OrchestratorConfig } from '../bundles/orchestrator/index.js'
import { Sandbox } from '../bundles/sandbox/index.js'
import { CrabboxProvider, type CrabboxConfig } from '../bundles/sandbox-crabbox/index.js'
import { CubeSandboxProvider, type CubeSandboxConfig } from '../bundles/sandbox-cubesandbox/index.js'
import { LocalTools, commandRisk, COMMAND_TOOL, type LocalToolsConfig } from '../bundles/tools-local/index.js'

/** Raised when the profile refuses to boot, or boots and then finds its guardrails are not enforcing. */
export class ProfileError extends Error {
  override name = 'ProfileError'
}

/** The lowest `confidenceThreshold` the profile accepts. At 0 every real-fs-write with any signal would be auto-approved, which is the gate switched off by another name. */
export const MIN_CONFIDENCE_THRESHOLD = 0.5
/** The self-test runs under this session id, so it never lands in a real task's log. */
export const SELFTEST_SESSION = 'profile-coding-selftest'

export interface ProfileCodingConfig {
  /** Required (D-029): consent is per project. */
  projectId: string
  /** Required, absolute. The one folder the file tools, the commands, the retrieval and the policy gate are all confined to. */
  projectRoot: string
  sessionLog?: SessionLogConfig
  egress?: Omit<EgressConfig, 'projectId'>
  modelAdapter?: ModelAdapterConfig
  toolRegistry?: ToolRegistryConfig
  subprocess?: SubprocessConfig
  agentLoop?: AgentLoopConfig
  /**
   * Approver, threshold, timeout, extra signals and deny rules. There is NO switch to turn the gate off: this profile has no `enabled`
   * flag, and an attempt to pass one is refused at boot (see {@link ProfileError}). `commandRisk` is always added to the signals.
   */
  policy?: Omit<PolicyConfig, 'projectRoot'>
  localTools?: Omit<LocalToolsConfig, 'root'>
  /** Fences and scans every tool result (D-083). Always on; this only tunes it. */
  inputGuard?: InputGuardConfig
  /** `deriveLessons` defaults to TRUE in this profile (templated from harness facts, D-083). */
  memory?: MemoryConfig
  /** Skills are never auto-discovered (D-0xx): without `dirs` the skills bundle is not loaded. */
  skills?: SkillsConfig
  /**
   * Isolated execution providers (5.1, 5.2). Absent = no sandbox provider registered (`ctx.sandbox` still exists, empty).
   * Remote providers (cubesandbox, any non-local crabbox provider) still need egress consent and an allowlisted host to run.
   * `default` names the provider used when a request names none.
   */
  sandbox?: { crabbox?: CrabboxConfig; cubesandbox?: CubeSandboxConfig; default?: 'crabbox' | 'cubesandbox' }
  retrieval?: {
    grep?: Omit<RetrievalGrepConfig, 'root'>
    treesitter?: RetrievalTreesitterConfig
    /** Give BOTH to add vector search; with neither, ranking is BM25 only. */
    embeddings?: EmbeddingsConfig
    vectorStore?: VectorStoreConfig
    rank?: Omit<RetrievalRankConfig, 'root'>
    tools?: RetrievalToolsConfig
  }
  orchestrator?: OrchestratorConfig
}

const ALLOWED_KEYS = new Set(['projectId', 'projectRoot', 'sessionLog', 'egress', 'modelAdapter', 'toolRegistry', 'subprocess', 'agentLoop', 'policy', 'inputGuard', 'localTools', 'memory', 'skills', 'retrieval', 'orchestrator', 'sandbox'])
const GATE_WORDS = /(polic|gate|guardrail|approval|confidence|deny)/i

/** Refuse, at boot and by name, anything that tries to switch the gates off or weaken them below the floor. */
function validate(config: unknown): asserts config is ProfileCodingConfig {
  if (!config || typeof config !== 'object') throw new ProfileError('profile-coding: config must be an object')
  const c = config as Record<string, unknown>
  for (const key of Object.keys(c)) {
    if (ALLOWED_KEYS.has(key)) continue
    if (GATE_WORDS.test(key)) throw new ProfileError(`profile-coding: "${key}" looks like a way to change the policy gates, and profile-coding cannot run with them off or altered. The only gate settings are inside "policy".`)
    throw new ProfileError(`profile-coding: unknown option "${key}"`)
  }
  if (typeof c['projectId'] !== 'string' || !c['projectId'].trim()) throw new ProfileError('profile-coding: projectId is required')
  if (typeof c['projectRoot'] !== 'string' || !isAbsolute(c['projectRoot'])) throw new ProfileError('profile-coding: projectRoot is required and must be an absolute path')
  if ('policy' in c) {
    const p = c['policy']
    if (p === false || p === null || (typeof p !== 'object' && p !== undefined)) throw new ProfileError('profile-coding: the policy gates cannot be disabled in this profile')
    if (p && typeof p === 'object') {
      const pol = p as Record<string, unknown>
      if (pol['enabled'] === false || pol['disabled'] === true || pol['off'] === true) throw new ProfileError('profile-coding: the policy gates cannot be disabled in this profile')
      if ('projectRoot' in pol) throw new ProfileError('profile-coding: set projectRoot at the top level; the gate is always judged against it')
      const t = pol['confidenceThreshold']
      if (t !== undefined && !(typeof t === 'number' && t >= MIN_CONFIDENCE_THRESHOLD && t <= 1)) throw new ProfileError(`profile-coding: policy.confidenceThreshold must be a number from ${MIN_CONFIDENCE_THRESHOLD} to 1 (below ${MIN_CONFIDENCE_THRESHOLD} the gate would approve nearly everything)`)
    }
  }
}

/**
 * Prove the gates are enforcing in THIS context, not merely configured. Throws {@link ProfileError} if they are not. Exported so it can be
 * run (and tested) against any context. It makes one real call through the registry and asks the gate two questions about the real
 * `run_command`; nothing is executed or changed, and it logs only under {@link SELFTEST_SESSION}.
 *  1. The deny-list is live in the registry's `tools/pre-execute` path: a probe tool called with `rm -rf /` must be refused and must not run.
 *  2. `commandRisk` is wired: a shell command at confidence 1 must be held, and the signal must be present and score a read-only command 1.
 *     (A stricter signal of the owner's own is fine; a laxer one that lets the shell through is not.)
 */
export async function verifyGates(ctx: Context): Promise<void> {
  const fail = (why: string): never => {
    throw new ProfileError(`profile-coding: the policy gates are not enforcing (${why}). Refusing to run.`)
  }
  const c = ctx as Context & { policy?: Context['policy']; tools?: Context['tools'] }
  if (!c.tools) return fail('no tool registry')
  if (!c.policy) return fail('policy-gates is not loaded')

  let ran = false
  const probe = '__profile_selftest'
  const off = c.tools.register({
    name: probe,
    description: 'Boot self-test. Never offered to a model.',
    actionClass: 'real-fs-write',
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } } },
    execute: () => {
      ran = true
      return 'ran'
    },
  })
  try {
    const r = await c.tools.call(probe, { command: 'rm', args: ['-rf', '/'], [CONFIDENCE_FIELD]: 1 }, { sessionId: SELFTEST_SESSION })
    if (ran || r.ok) fail('a deny-listed call was not blocked')
  } finally {
    off()
  }

  const def = c.tools.list().find((t) => t.name === COMMAND_TOOL)
  if (!def) return fail(`${COMMAND_TOOL} is not registered, so command risk cannot be checked`)
  const ask = (args: string[], command: string) => c.policy!.evaluate({ sessionId: SELFTEST_SESSION, tool: def, input: { command, args, [CONFIDENCE_FIELD]: 1 } })
  if (ask(['-c', 'echo hi'], 'sh').verdict !== 'hold') fail('a shell command at confidence 1 was not held (is commandRisk wired?)')
  // Wired means PRESENT, not "lets it through": an owner's own stricter signal may legitimately hold a read-only command too.
  if (!ask(['--version'], 'node').signals?.some((x) => x.name === 'command-risk' && x.score === 1)) fail('the command-risk signal is not wired in')
}

/** Services this profile must end up with. A plugin whose dependency is absent is never started and does not throw, so boot checks for them by name. */
export function missingServices(ctx: Context, withSkills: boolean): string[] {
  const live = ctx as unknown as Record<string, unknown>
  return ['log', 'egress', 'llm', 'tools', 'subprocess', 'agentLoop', 'memory', 'subagents', 'policy', 'inputGuard', 'retrievalGrep', 'retrievalRank', 'retrievalTools', 'localTools', 'orchestrator', ...(withSkills ? ['skills'] : [])].filter((k) => !live[k])
}

/**
 * `profile-coding` (5.6): the stack for coding on a real project. Boot order is the dependency order, plus one rule that matters:
 * `subagent-scope` is registered BEFORE `policy-gates`, so on every call a scope refusal comes first and the gate (and any approval
 * wait) only ever sees calls the agent was allowed to make. Then the real tools, which are registered after the gate exists.
 *
 * Guardrails are config in this profile, never a runtime toggle (D-029, PRD, TRD): there is no `enabled` flag, passing one is refused,
 * `commandRisk` is always passed to the gate, the threshold has a floor, and after boot `verifyGates` must pass or the context is torn
 * down and the boot fails. `bundle-egress` boots unconditionally, as in `profile-minimal`.
 */
export async function bootProfileCoding(config: ProfileCodingConfig): Promise<Context> {
  validate(config)
  const root = config.projectRoot
  const ctx = new Context()
  try {
    await ctx.plugin(SessionLog, config.sessionLog)
    await ctx.plugin(EgressPolicy, { ...config.egress, projectId: config.projectId })
    await ctx.plugin(LLMService, config.modelAdapter)
    await ctx.plugin(ToolRegistry, config.toolRegistry)
    await ctx.plugin(Subprocess, config.subprocess)
    await ctx.plugin(Sandbox)
    if (config.sandbox?.crabbox) ctx.sandbox.register(new CrabboxProvider(ctx.subprocess, config.sandbox.crabbox), { default: config.sandbox.default === 'crabbox' })
    if (config.sandbox?.cubesandbox) ctx.sandbox.register(new CubeSandboxProvider(config.sandbox.cubesandbox), { default: config.sandbox.default === 'cubesandbox' })
    await ctx.plugin(AgentLoop, config.agentLoop)
    await ctx.plugin(Memory, { deriveLessons: true, ...config.memory })
    await ctx.plugin(SubagentScope)
    const userSignals = (config.policy?.signals ?? []).filter((s) => s !== commandRisk)
    await ctx.plugin(PolicyGates, { ...config.policy, projectRoot: root, signals: [commandRisk, ...userSignals] })

    const r = config.retrieval ?? {}
    await ctx.plugin(InputGuard, config.inputGuard)
    await ctx.plugin(RetrievalGrep, { ...r.grep, root })
    await ctx.plugin(RetrievalTreesitter, r.treesitter)
    if (r.embeddings && r.vectorStore) {
      await ctx.plugin(Embeddings, r.embeddings)
      await ctx.plugin(LanceVectorStore, r.vectorStore)
    }
    await ctx.plugin(RetrievalRank, { ...r.rank, root })
    await ctx.plugin(RetrievalTools, r.tools)
    await ctx.plugin(LocalTools, { ...config.localTools, root })
    if (config.skills) await ctx.plugin(Skills, config.skills)
    await ctx.plugin(Orchestrator, config.orchestrator)

    // Cordis does not throw when a plugin's constructor fails (it logs and carries on), so check the services are really there.
    const missing = missingServices(ctx, !!config.skills)
    if (missing.length) throw new ProfileError(`profile-coding: did not boot, these services failed to start: ${missing.join(', ')}`)
    await verifyGates(ctx)
    return ctx
  } catch (e) {
    await (ctx as unknown as { stop?: () => Promise<void> }).stop?.().catch(() => {})
    throw e
  }
}
