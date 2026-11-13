import { Context, Service } from 'cordis'
import '../session-log/index.js'
import '../tool-registry/index.js'
import '../agent-loop/index.js'
import '../memory/index.js'
import { ToolDeniedError, type RequiredToolSequence, type ToolCallEvent } from '../tool-registry/index.js'
import { ScopeError, type SubAgent, type SubagentRunOptions, type SubagentSpec } from './types.js'

export * from './types.js'

declare module 'cordis' {
  interface Context {
    subagents: SubagentScope
  }
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const PREFIX = 'subagent:'

interface Scope {
  id: string
  actor: string
  tools: ReadonlySet<string>
  parent?: string
  sessionId: string
  closed: boolean
  requiredToolSequence?: RequiredToolSequence
}

/**
 * `ctx.subagents` — 4.3. A sub-agent is a named grant of tools, enforced in two places so that
 * neither alone is trusted (D-068):
 *   1. every run offers the model only the grant, and the registry refuses any call outside the
 *      offered list (`ToolContext.allowedTools`);
 *   2. a `tools/pre-execute` hook denies any call whose actor is `subagent:<id>` unless the tool is
 *      in that agent's grant, whoever made the call. An actor in the `subagent:` namespace with no
 *      live scope (closed, or forged) is denied everything: fail closed.
 * Grants are explicit and never inherited: a child's grant must be a subset of its parent's, and a
 * sibling's grant has no effect on it.
 *
 * Memory (D-073), when the memory bundle is loaded: each agent also gets a `MemoryGrant`. It always sees its own episodes
 * and its own scoped hot rules; global hot rules only if granted (default yes). Closing the agent revokes the grant, and a
 * `subagent:` actor with no live grant sees nothing from memory. Runs are recorded as episodes under the agent's own id.
 */
export class SubagentScope extends Service {
  // `memory` is deliberately NOT injected: in this cordis, every injected service is required, and sub-agents must work without
  // it. It is read through the root context instead (see `mem`), which sees it if and when it is loaded.
  static inject = ['log', 'tools', 'agentLoop']

  /** The memory service if the memory bundle is loaded, else undefined. */
  private get mem() {
    return (this.ctx.root as Context & { memory?: Context['memory'] }).memory
  }

  private scopes = new Map<string, Scope>()

  constructor(ctx: Context) {
    super(ctx, 'subagents')
    ctx.on('tools/pre-execute', (ev: ToolCallEvent) => this.guard(ev))
  }

  private guard(ev: ToolCallEvent): void {
    const actor = ev.actor
    if (!actor?.startsWith(PREFIX)) return
    const scope = this.scopes.get(actor.slice(PREFIX.length))
    if (!scope || scope.closed) throw new ToolDeniedError(`actor "${actor}" has no live sub-agent scope`)
    if (!scope.tools.has(ev.tool.name)) throw new ToolDeniedError(`tool "${ev.tool.name}" is outside the grant of sub-agent "${scope.id}"`)
  }

  /**
   * A scope is live only if it and EVERY ancestor are open (SEC-03). `close()` revokes the whole
   * subtree, but the guard checks the chain too, so a grandchild can never outlive its parent even
   * if some future code path marks a scope closed without walking its descendants.
   */
  private alive(scope: Scope): boolean {
    for (let s: Scope | undefined = scope; s; s = s.parent !== undefined ? this.scopes.get(s.parent) : undefined) {
      if (s.closed) return false
      if (s.parent !== undefined && !this.scopes.has(s.parent)) return false
    }
    return true
  }

  /** Close `scope` and all descendants, deepest first, logging each close. Idempotent. */
  private async closeTree(scope: Scope): Promise<void> {
    // Mark the whole subtree closed synchronously first, so no call can slip through between awaits.
    const order: Scope[] = []
    const visit = (s: Scope) => {
      for (const c of this.scopes.values()) if (c.parent === s.id && c !== s) visit(c)
      order.push(s)
    }
    visit(scope)
    for (const s of order) {
      if (s.closed) continue
      s.closed = true
      this.mem?.access.revoke(s.actor)
    }
    for (const s of order) await this.ctx.log.append(s.sessionId, 'subagent.close', { id: s.id, ...(s.id !== scope.id ? { cause: `ancestor ${scope.id} closed` } : {}) }, 'subagent-scope')
  }

  async spawn(spec: SubagentSpec): Promise<SubAgent> {
    if (!ID_RE.test(spec.id)) throw new ScopeError(`invalid sub-agent id ${JSON.stringify(spec.id)} (use 1-64 of A-Z a-z 0-9 _ -)`)
    if (this.scopes.has(spec.id)) throw new ScopeError(`sub-agent "${spec.id}" already exists`)
    const grant = [...new Set(spec.tools)]
    for (const t of grant) {
      if (!this.ctx.tools.has(t)) throw new ScopeError(`sub-agent "${spec.id}": granted tool "${t}" is not registered`)
    }
    if (spec.parent !== undefined) {
      const p = this.scopes.get(spec.parent)
      if (!p || !this.alive(p)) throw new ScopeError(`sub-agent "${spec.id}": parent "${spec.parent}" is not a live sub-agent`)
      for (const t of grant) {
        if (!p.tools.has(t)) throw new ScopeError(`sub-agent "${spec.id}": tool "${t}" is not in parent "${spec.parent}"'s grant (a child cannot widen it)`)
      }
    }
    if (spec.requiredTools !== undefined) {
      if (!Array.isArray(spec.requiredTools) || spec.requiredTools.length === 0 || spec.requiredTools.some((name) => typeof name !== 'string' || !grant.includes(name))) {
        throw new ScopeError(`sub-agent "${spec.id}": requiredTools must be an ordered list contained in its tool grant`)
      }
    }
    const scope: Scope = { id: spec.id, actor: PREFIX + spec.id, tools: new Set(grant), ...(spec.requiredTools !== undefined ? { requiredToolSequence: { tools: [...spec.requiredTools], state: { nextIndex: 0 } } } : {}), ...(spec.parent !== undefined ? { parent: spec.parent } : {}), sessionId: spec.sessionId, closed: false }
    // Log first: a spawn that cannot be recorded must not exist.
    await this.ctx.log.append(spec.sessionId, 'subagent.spawn', { id: spec.id, tools: grant, parent: spec.parent ?? null }, 'subagent-scope')
    this.scopes.set(spec.id, scope)
    this.mem?.access.grant(scope.actor, spec.memory ?? { hot: 'global' })
    return this.handle(scope, spec)
  }

  list(): { id: string; tools: string[]; parent?: string }[] {
    return [...this.scopes.values()].filter((s) => this.alive(s)).map((s) => ({ id: s.id, tools: [...s.tools], ...(s.parent !== undefined ? { parent: s.parent } : {}) }))
  }

  private handle(scope: Scope, spec: SubagentSpec): SubAgent {
    const self = this
    return {
      id: scope.id,
      actor: scope.actor,
      tools: [...scope.tools],
      get requiredToolsComplete() {
        return scope.requiredToolSequence === undefined || scope.requiredToolSequence.state.nextIndex >= scope.requiredToolSequence.tools.length
      },
      get requiredToolsRemaining() {
        return scope.requiredToolSequence?.tools.slice(scope.requiredToolSequence.state.nextIndex) ?? []
      },
      ...(scope.parent !== undefined ? { parent: scope.parent } : {}),
      get closed() {
        return !self.alive(scope)
      },
      get memory() {
        return self.mem?.view(scope.actor)
      },
      async run(prompt: string, opts: SubagentRunOptions = {}) {
        if (scope.closed) throw new ScopeError(`sub-agent "${scope.id}" is closed`)
        const tools = opts.tools ?? [...scope.tools]
        for (const t of tools) {
          if (!scope.tools.has(t)) throw new ScopeError(`sub-agent "${scope.id}": run asked for tool "${t}" outside its grant`)
        }
        const { sessionId, tools: _t, system, maxSteps, lesson, ...rest } = opts
        // Required tool sequences are per agent.run attempt, not per scope lifetime. Orchestrator retries
        // reuse the same scoped agent, so each attempt must begin at index zero.
        if (scope.requiredToolSequence) {
          scope.requiredToolSequence = { tools: [...scope.requiredToolSequence.tools], state: { nextIndex: 0 } }
        }
        const runOpts = {
          ...rest,
          sessionId: sessionId ?? spec.sessionId,
          actor: scope.actor,
          prompt,
          tools,
          ...(scope.requiredToolSequence ? { requiredToolSequence: scope.requiredToolSequence } : {}),
          ...((system ?? spec.system) !== undefined ? { system: (system ?? spec.system)! } : {}),
          ...((maxSteps ?? spec.maxSteps) !== undefined ? { maxSteps: (maxSteps ?? spec.maxSteps)! } : {}),
        }
        const memory = self.mem
        if (!memory) return self.ctx.agentLoop.run(runOpts)
        return memory.runTurn({ ...runOpts, ...(lesson !== undefined ? { lesson } : {}) })
      },
      async close() {
        if (scope.closed) return
        // Descendants die with the parent at every depth: a grant cannot outlive the grant it was cut from (SEC-03).
        await self.closeTree(scope)
      },
    }
  }
}

export const name = 'bundle-subagent-scope'
export function apply(ctx: Context) {
  ctx.plugin(SubagentScope)
}
