import type { Candidate, DecisionClass, RouterBackend } from './types.js'

const STOP = new Set('a an the and or of to in on for with from by is are be it this that as at into then it its do does how what which use using please can you i we our my your'.split(' '))
const tokens = (s: string): string[] => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOP.has(t)).map((t) => (t.length > 4 ? t.replace(/(ing|ed|es|s)$/, '') : t))

/**
 * Fallback 2: deterministic token overlap between the task and each candidate's id + description. Abstains unless one
 * candidate scores >= 1 AND strictly beats the runner-up, so it never guesses between ties.
 */
export class RulesBackend implements RouterBackend {
  readonly name = 'rules' as const
  async decide(_cls: DecisionClass, req: { task: string; candidates: Candidate[] }): Promise<string | null> {
    const t = new Set(tokens(req.task))
    const scored = req.candidates.map((c) => ({ id: c.id, score: new Set(tokens(`${c.id.replace(/[_-]/g, ' ')} ${c.description}`)).size === 0 ? 0 : [...new Set(tokens(`${c.id.replace(/[_-]/g, ' ')} ${c.description}`))].filter((x) => t.has(x)).length }))
    scored.sort((a, b) => b.score - a.score)
    if (!scored[0] || scored[0].score < 1) return null
    if (scored[1] && scored[1].score === scored[0].score) return null
    return scored[0].id
  }
}

export interface WorkerLike {
  complete(req: { sessionId: string; system?: string; messages: Array<{ role: 'user'; content: string }>; maxTokens?: number; temperature?: number }, signal?: AbortSignal): Promise<{ text: string }>
}

/** Fallback 3 and the baseline Needle must beat: ask the worker model, one request per decision. */
export class WorkerBackend implements RouterBackend {
  readonly name = 'worker' as const
  readonly requestCost = 1
  constructor(private readonly llm: WorkerLike, private readonly sessionId = 'router') {}
  async decide(cls: DecisionClass, req: { task: string; candidates: Candidate[]; sessionId?: string; signal?: AbortSignal }): Promise<string | null> {
    const list = req.candidates.map((c) => `- ${c.id}: ${c.description}`).join('\n')
    const r = await this.llm.complete({
      sessionId: req.sessionId ?? this.sessionId,
      system: `You route a task to exactly one ${cls}. Reply with ONLY the id of the best one, nothing else. If none fits, reply NONE.`,
      messages: [{ role: 'user', content: `Task: ${req.task}\n\nOptions:\n${list}` }],
      maxTokens: 20,
      temperature: 0,
    }, req.signal)
    const text = r.text.trim().replace(/^["'`]+|["'`.]+$/g, '')
    return text.toUpperCase() === 'NONE' ? null : text
  }
}

