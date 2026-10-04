import type { Plan, PlannerLimits, Subtask } from './types.js'

export const DEFAULT_LIMITS: PlannerLimits = { maxSubtasks: 8, maxToolsPerSubtask: 3, maxGoalChars: 400, maxIdChars: 32 }

const ID_RE = /^[A-Za-z0-9_-]+$/
const MAX_ERRORS = 10

/**
 * The reply must be EXACTLY one JSON object, raw or in one fenced block. Prose around it is rejected
 * (all-or-nothing, as D-067 does for recovered tool calls): a plan is an instruction to act, so it is
 * not guessed out of surrounding text.
 */
export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let body = text.trim()
  const fence = /^```[A-Za-z]*\s*\n?([\s\S]*?)\n?```$/.exec(body)
  if (fence) body = fence[1]!.trim()
  if (!body.startsWith('{') || !body.endsWith('}')) return { ok: false, error: 'the reply must be exactly one JSON object and nothing else' }
  try {
    return { ok: true, value: JSON.parse(body) }
  } catch (e: any) {
    return { ok: false, error: `the reply is not valid JSON (${e?.message ?? e})` }
  }
}

export function validatePlan(
  task: string,
  raw: unknown,
  registered: ReadonlySet<string>,
  limits: PlannerLimits = DEFAULT_LIMITS,
): { ok: true; plan: Plan } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const err = (m: string) => {
    if (errors.length < MAX_ERRORS) errors.push(m)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['the top level must be an object like {"subtasks": [...]}'] }
  const list = (raw as any).subtasks
  if (!Array.isArray(list)) return { ok: false, errors: ['"subtasks" must be an array'] }
  if (list.length === 0) return { ok: false, errors: ['"subtasks" must contain at least one subtask'] }
  if (list.length > limits.maxSubtasks) return { ok: false, errors: [`too many subtasks (${list.length}); the limit is ${limits.maxSubtasks}, so merge or drop some`] }

  const subtasks: Subtask[] = []
  const seen = new Set<string>()
  list.forEach((s: any, i: number) => {
    const at = `subtask ${i + 1}`
    if (!s || typeof s !== 'object' || Array.isArray(s)) return err(`${at}: must be an object`)
    const { id, goal } = s
    if (typeof id !== 'string' || !ID_RE.test(id) || id.length > limits.maxIdChars) {
      err(`${at}: "id" must be a string of letters, digits, _ or - (at most ${limits.maxIdChars})`)
    } else if (seen.has(id)) {
      err(`${at}: duplicate id "${id}"`)
    }
    if (typeof goal !== 'string' || !goal.trim()) err(`${at}: "goal" must be a non-empty string`)
    else if (goal.length > limits.maxGoalChars) err(`${at}: "goal" is too long (${goal.length}); the limit is ${limits.maxGoalChars}, so make it narrower`)

    const tools = s.tools ?? []
    if (!Array.isArray(tools) || tools.some((t: unknown) => typeof t !== 'string')) err(`${at}: "tools" must be an array of strings`)
    else {
      if (tools.length > limits.maxToolsPerSubtask) err(`${at}: too many tools (${tools.length}); the limit is ${limits.maxToolsPerSubtask}`)
      for (const t of tools) if (!registered.has(t)) err(`${at}: unknown tool "${t}"; available tools: ${[...registered].join(', ') || 'none'}`)
    }

    const deps = s.dependsOn ?? []
    if (!Array.isArray(deps) || deps.some((d: unknown) => typeof d !== 'string')) err(`${at}: "dependsOn" must be an array of strings`)
    else for (const d of deps) if (!seen.has(d)) err(`${at}: dependsOn "${d}" must be the id of an EARLIER subtask`)

    if (typeof id === 'string') seen.add(id)
    if (typeof id === 'string' && typeof goal === 'string' && Array.isArray(tools) && Array.isArray(deps)) {
      subtasks.push({ id, goal: goal.trim(), tools: [...new Set<string>(tools)], dependsOn: [...new Set<string>(deps)] })
    }
  })
  if (errors.length) return { ok: false, errors }
  return { ok: true, plan: { task, subtasks } }
}

export function plannerSystem(tools: { name: string; description: string }[], limits: PlannerLimits): string {
  const toolText = tools.length ? tools.map((t) => `- ${t.name}: ${t.description}`).join('\n') : '(no tools)'
  return [
    'You are a planner. Break the user\'s task into a short ordered list of narrow subtasks. You do not do the work and you cannot call tools.',
    `Reply with ONLY one JSON object, no other text: {"subtasks":[{"id":"s1","goal":"...","tools":["tool_name"],"dependsOn":[]}]}`,
    `Rules: at most ${limits.maxSubtasks} subtasks; ids are unique; each goal is one small self-contained step; each subtask lists at most ${limits.maxToolsPerSubtask} tools, only from the list below; "dependsOn" lists ids of EARLIER subtasks only.`,
    'Tools you may assign:',
    toolText,
  ].join('\n')
}
