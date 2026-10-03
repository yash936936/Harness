export interface Skill {
  /** From the frontmatter; equals the folder name (spec). */
  name: string
  description: string
  /** Real (symlink-resolved) path of the skill folder. */
  dir: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  /** Parsed from `allowed-tools`. Experimental in the spec and NOT enforced or honoured here (D-065). */
  allowedTools?: string[]
}

export type SkillProblemKind = 'no_skill_md' | 'unreadable' | 'bad_frontmatter' | 'invalid' | 'name_mismatch' | 'duplicate' | 'too_large'
export interface SkillProblem {
  dir: string
  kind: SkillProblemKind
  reason: string
}

/** Pick the skills worth loading for a task. Return skill names, best first. */
export type SkillMatcher = (task: string, skills: readonly Skill[]) => string[] | Promise<string[]>

export interface SkillsConfig {
  /**
   * Where skills live, in precedence order (the first skill of a given name wins).
   * Each entry is either a skill folder (has a SKILL.md) or a parent folder whose
   * immediate subfolders are skills. There is NO default and no auto-discovery:
   * skills are instructions the model will follow, so the owner must name each place.
   */
  dirs: string[]
  /** Put the name + description of every skill in each run's system prompt. Default true. */
  index?: boolean
  /** Index budget in estimated tokens (chars/3). Skills that do not fit are left out of the index (still loadable by name). Default 2000. */
  maxIndexTokens?: number
  /** A SKILL.md body above this many estimated tokens is refused. Spec recommends under 5000. Default 5000. */
  maxInstructionTokens?: number
  /** Longest resource returned by `read_skill_resource`, in characters. Default 20000. */
  maxResourceChars?: number
  /**
   * OFF by default. The standard mechanism is the model calling `load_skill`; small local
   * models are often unreliable at that, so a host-side matcher can load the instructions
   * of the best-matching skill(s) into the system prompt for the run instead.
   */
  autoLoad?: { matcher: SkillMatcher; max?: number }
  estimateTokens?: (text: string) => number
}

export class SkillsConfigError extends Error {
  override name = 'SkillsConfigError'
}
