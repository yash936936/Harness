import { Context } from 'cordis'
import { SessionLog, type SessionLogConfig } from '../bundles/session-log/index.js'
import { EgressPolicy, type EgressConfig } from '../bundles/egress/index.js'
import { LLMService, type ModelAdapterConfig } from '../bundles/model-adapter/index.js'
import { ToolRegistry, type ToolRegistryConfig } from '../bundles/tool-registry/index.js'
import { Subprocess, type SubprocessConfig } from '../bundles/subprocess/index.js'
import { AgentLoop, type AgentLoopConfig } from '../bundles/agent-loop/index.js'

export interface ProfileMinimalConfig {
  sessionLog?: SessionLogConfig
  /**
   * Required (1B.1, D-029): consent is tracked per project, so there is no
   * default. `egress` fills in the rest of `EgressConfig` (allowlist,
   * consent store, secrets) - `projectId` lives at the top level because
   * it is not optional the way the rest of that config is.
   */
  projectId: string
  egress?: Omit<EgressConfig, 'projectId'>
  modelAdapter?: ModelAdapterConfig
  toolRegistry?: ToolRegistryConfig
  subprocess?: SubprocessConfig
  agentLoop?: AgentLoopConfig
}

/**
 * `profile-minimal` (1.6, `docs/phases.md`) — composes 1.1-1.5 into one
 * runnable stack: session-log -> {model-adapter, tool-registry, subprocess}
 * -> agent-loop, the dependency order `docs/architecture.md` specifies.
 *
 * NOTE on "single config resolution": the design draft describes this as
 * resolved via `cordis.patch.yml`. That loader is `@cordisjs/plugin-loader`
 * (+ `@cordisjs/plugin-include`), an *optional peer dependency* of `cordis`
 * that this project does not install (see `package.json` - only bare
 * `cordis` is a dependency). Pulling it in means adopting its own config
 * schema, hot-reload and plugin-group machinery, which is more than
 * `profile-minimal` needs. So for 1.6 the "single config resolution" is
 * this function: one `ProfileMinimalConfig` object in, one boot call, no
 * separate manual `ctx.plugin()` sequence for the caller to get right.
 * `profile-minimal.yml` alongside this file documents the same shape as
 * data for humans/other tooling to read; it is not auto-loaded by Cordis
 * itself. Logged as D-033 in `docs/decisions.md` - reopen if a later phase
 * (profile-research / profile-full, or multiple named profiles on disk)
 * actually needs the real loader.
 *
 * `bundle-egress` (1B.1) boots unconditionally, before `model-adapter` -
 * not behind a config flag. D-029: egress controls cannot be disabled in
 * any profile, `profile-minimal` included, so there is no code path here
 * that skips it.
 */
export async function bootProfileMinimal(config: ProfileMinimalConfig): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionLog, config.sessionLog)
  await ctx.plugin(EgressPolicy, { ...config.egress, projectId: config.projectId })
  await ctx.plugin(LLMService, config.modelAdapter)
  await ctx.plugin(ToolRegistry, config.toolRegistry)
  await ctx.plugin(Subprocess, config.subprocess)
  await ctx.plugin(AgentLoop, config.agentLoop)
  return ctx
}
