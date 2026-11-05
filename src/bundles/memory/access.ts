/** Actors that are sub-agents (`subagent-scope`) are named `subagent:<id>`. Kept here so memory needs no import of that bundle. */
export const SCOPED_ACTOR_PREFIX = 'subagent:'

export function isScopedActor(actor: string | undefined): actor is string {
  return typeof actor === 'string' && actor.startsWith(SCOPED_ACTOR_PREFIX)
}

/** What a sub-agent may see of memory. Its OWN episodes and its OWN scoped hot rules are always visible to it; nothing else is, unless listed here. */
export interface MemoryGrant {
  /** `global`: also sees the owner-curated global hot rules (default). `none`: sees only rules scoped to it. */
  hot: 'global' | 'none'
  /** Semantic project facts are denied unless this capability is explicitly granted. */
  semantic?: boolean
}

/**
 * Live memory grants, one per sub-agent actor (D-073). A scoped actor with NO grant (never spawned, closed, or forged)
 * sees nothing from memory at all, not even global rules: fail closed, as the tool hook does.
 */
export class MemoryAccess {
  private grants = new Map<string, MemoryGrant>()

  grant(actor: string, grant: MemoryGrant = { hot: 'global' }): void {
    if (!isScopedActor(actor)) throw new Error(`memory access: "${actor}" is not a sub-agent actor (expected "${SCOPED_ACTOR_PREFIX}<id>")`)
    if (grant.hot !== 'global' && grant.hot !== 'none') throw new Error(`memory access: invalid hot grant ${JSON.stringify(grant.hot)}`)
    if (grant.semantic !== undefined && typeof grant.semantic !== 'boolean') throw new Error('memory access: semantic grant must be a boolean')
    this.grants.set(actor, { hot: grant.hot, semantic: grant.semantic ?? false })
  }

  revoke(actor: string): void {
    this.grants.delete(actor)
  }

  get(actor: string): MemoryGrant | undefined {
    const g = this.grants.get(actor)
    return g ? { ...g } : undefined
  }
}
