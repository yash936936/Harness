import { Context, Service } from 'cordis'
import '../session-log/index.js'
import '../tool-registry/index.js'
import '../agent-loop/index.js'
import { ToolDeniedError, type ToolCallEvent } from '../tool-registry/index.js'
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
  closed: boolean
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
 * sibling's grant has no effect on it. NOT scoped here: memory (the memory bundle has no per-scope
 * namespace yet; see D-068).
 */
export class SubagentScope extends Service {
  static inject = ['log', 'tools', 'agentLoop']

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

  async spawn(spec: SubagentSpec): Promise<SubAgent> {
    if (!ID_RE.test(spec.id)) throw new ScopeError(`invalid sub-agent id ${JSON.stringify(spec.id)} (use 1-64 of A-Z a-z 0-9 _ -)`)
    if (this.scopes.has(spec.id)) throw new ScopeError(`sub-agent "${spec.id}" already exists`)
    const grant = [...new Set(spec.tools)]
    for (const t of grant) {
      if (!this.ctx.tools.has(t)) throw new ScopeError(`sub-agent "${spec.id}": granted tool "${t}" is not registered`)
    }
    if (spec.parent !== undefined) {
      const p = this.scopes.get(spec.parent)
      if (!p || p.closed) throw new ScopeError(`sub-agent "${spec.id}": parent "${spec.parent}" is not a live sub-agent`)
      for (const t of grant) {
        if (!p.tools.has(t)) throw new ScopeError(`sub-agent "${spec.id}": tool "${t}" is not in parent "${spec.parent}"'s grant (a child cannot widen it)`)
      }
    }
    const scope: Scope = { id: spec.id, actor: PREFIX + spec.id, tools: new Set(grant), ...(spec.parent !== undefined ? { parent: spec.parent } : {}), closed: false }
    // Log first: a spawn that cannot be recorded must not exist.
    await this.ctx.log.append(spec.sessionId, 'subagent.spawn', { id: spec.id, tools: grant, parent: spec.parent ?? null }, 'subagent-scope')
    this.scopes.set(spec.id, scope)
    return this.handle(scope, spec)
  }

  list(): { id: string; tools: string[]; parent?: string }[] {
    return [...this.scopes.values()].filter((s) => !s.closed).map((s) => ({ id: s.id, tools: [...s.tools], ...(s.parent !== undefined ? { parent: s.parent } : {}) }))
  }

  private handle(scope: Scope, spec: SubagentSpec): SubAgent {
    const self = this
    return {
      id: scope.id,
      actor: scope.actor,
      tools: [...scope.tools],
      ...(scope.parent !== undefined ? { parent: scope.parent } : {}),
      get closed() {
        return scope.closed
      },
      async run(prompt: string, opts: SubagentRunOptions = {}) {
        if (scope.closed) throw new ScopeError(`sub-agent "${scope.id}" is closed`)
        const tools = opts.tools ?? [...scope.tools]
        for (const t of tools) {
          if (!scope.tools.has(t)) throw new ScopeError(`sub-agent "${scope.id}": run asked for tool "${t}" outside its grant`)
        }
        const { sessionId, tools: _t, system, maxSteps, ...rest } = opts
        return self.ctx.agentLoop.run({
          ...rest,
          sessionId: sessionId ?? spec.sessionId,
          actor: scope.actor,
          prompt,
          tools,
          ...((system ?? spec.system) !== undefined ? { system: (system ?? spec.system)! } : {}),
          ...((maxSteps ?? spec.maxSteps) !== undefined ? { maxSteps: (maxSteps ?? spec.maxSteps)! } : {}),
        })
      },
      async close() {
        if (scope.closed) return
        scope.closed = true
        // Children die with the parent: a grant cannot outlive the grant it was cut from.
        for (const s of self.scopes.values()) if (s.parent === scope.id && !s.closed) s.closed = true
        await self.ctx.log.append(spec.sessionId, 'subagent.close', { id: scope.id }, 'subagent-scope')
      },
    }
  }
}

export const name = 'bundle-subagent-scope'
export function apply(ctx: Context) {
  ctx.plugin(SubagentScope)
}
