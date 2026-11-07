/** Actors that are sub-agents (`subagent-scope`) are named `subagent:<id>`. Kept here so memory needs no import of that bundle. */
export const SCOPED_ACTOR_PREFIX = 'subagent:'

export function isScopedActor(actor: string | undefined): actor is string {
  return typeof actor === 'string' && actor.startsWith(SCOPED_ACTOR_PREFIX)
}

/** What a sub-agent may see of memory. Its OWN episodes and its OWN scoped hot rules are visible by default; global hot rules and semantic facts require explicit capabilities. */
export interface MemoryGrant {
  /** `global`: also sees the owner-curated global hot rules (default). `none`: sees only rules scoped to it. */
  hot: 'global' | 'none'
  /** Explicitly allow this agent to query semantic facts. */
  semantic?: boolean
}

/**
 * Live memory grants, one per sub-agent actor (D-073). A scoped actor with NO grant (never spawned, closed, or forged)
 * sees nothing from memory at all, not even global rules: fail closed, as the tool hook does.
 */
export class MemoryAccess {
  private grants = new Map<string, MemoryGrant>()
  private semanticActors = new Set<string>()

  grant(actor: string, grant: MemoryGrant = { hot: 'global' }): void {
    if (!isScopedActor(actor)) throw new Error(`memory access: "${actor}" is not a sub-agent actor (expected "${SCOPED_ACTOR_PREFIX}<id>")`)
    if (grant.hot !== 'global' && grant.hot !== 'none') throw new Error(`memory access: invalid hot grant ${JSON.stringify(grant.hot)}`)
    if (grant.semantic !== undefined && typeof grant.semantic !== 'boolean') throw new Error('memory access: semantic grant must be boolean')
    this.grants.set(actor, { hot: grant.hot, ...(grant.semantic ? { semantic: true } : {}) })
    if (grant.semantic) this.semanticActors.add(actor)
    else this.semanticActors.delete(actor)
  }

  revoke(actor: string): void {
    this.grants.delete(actor)
    this.semanticActors.delete(actor)
  }

  get(actor: string): MemoryGrant | undefined {
    const g = this.grants.get(actor)
    return g ? { ...g } : undefined
  }

  grantSemantic(actor: string): void {
    if (!isScopedActor(actor) || !this.grants.has(actor)) throw new Error(`memory access: cannot grant semantic access to inactive actor "${actor}"`)
    this.semanticActors.add(actor)
    this.grants.set(actor, { ...this.grants.get(actor)!, semantic: true })
  }

  canQuerySemantic(actor: string): boolean {
    return this.semanticActors.has(actor) && this.grants.has(actor)
  }

  revokeSemantic(actor: string): void {
    this.semanticActors.delete(actor)
    const grant = this.grants.get(actor)
    if (grant) this.grants.set(actor, { hot: grant.hot })
  }
}
