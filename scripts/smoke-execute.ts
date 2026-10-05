/**
 * Real-model end-to-end check for 4.1 + 4.2: plan a task, then execute the plan.
 *
 *   HARNESS_OLLAMA_CHAT_MODEL=llama3.2:3b HARNESS_TRIALS=3 npx tsx scripts/smoke-execute.ts
 *   HARNESS_PLANNER_MODEL=qwen2.5-coder:3b-instruct HARNESS_WORKER_MODEL=llama3.2:3b npx tsx scripts/smoke-execute.ts
 *   HARNESS_ON_FAILURE=continue HARNESS_RETRIES=1 ...        (the D-074 policy knobs; defaults are abort / 0)
 *
 * For each trial it reports: did planning produce a valid plan; per subtask the final status; how many REAL tool calls the
 * workers made; and whether every completed subtask gave a non-empty answer. It does NOT judge whether any answer is CORRECT or
 * the plan GOOD: tools return canned text, so "correct" cannot be checked here. Not pass/fail; exits non-zero only if it could
 * not run. Without any model variable it runs a deterministic stand-in to self-test the script (not a measurement of a model).
 * A few trials are counts, not rates.
 */
import { Context } from 'cordis'
import { AgentLoop } from '../src/bundles/agent-loop/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { LLMService, MockProvider, OllamaProvider, type LLMProvider } from '../src/bundles/model-adapter/index.js'
import { Orchestrator, PlanError } from '../src/bundles/orchestrator/index.js'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { SubagentScope } from '../src/bundles/subagent-scope/index.js'
import { ToolRegistry } from '../src/bundles/tool-registry/index.js'

const base = process.env['HARNESS_OLLAMA_CHAT_MODEL']?.trim()
const plannerModel = process.env['HARNESS_PLANNER_MODEL']?.trim() || base
const workerModel = process.env['HARNESS_WORKER_MODEL']?.trim() || base
const STAND_IN = !plannerModel || !workerModel
const TRIALS = Math.max(1, Number(process.env['HARNESS_TRIALS'] ?? 3) || 3)
const ON_FAILURE = process.env['HARNESS_ON_FAILURE'] === 'continue' ? 'continue' : 'abort'
const RETRIES = Math.max(0, Math.min(3, Number(process.env['HARNESS_RETRIES'] ?? 0) || 0))
const TASKS = [
  'Find where the retry logic lives and explain how it works.',
  'Find the function parseConfig and describe what it returns.',
]
const TOOLS = ['search_code', 'read_file']
const STAND_PLAN = JSON.stringify({ subtasks: [{ id: 's1', goal: 'find the code', tools: ['search_code'], dependsOn: [] }, { id: 's2', goal: 'explain it', tools: ['read_file'], dependsOn: ['s1'] }] })

async function trial(planner: LLMProvider, worker: LLMProvider, task: string, n: number) {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(EgressPolicy, { projectId: 'smoke-exec' })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LLMService, {})
  ctx.llm.register('planner', planner, { default: true })
  ctx.llm.register('worker', worker)
  await ctx.plugin(AgentLoop, {})
  ctx.tools.register({ name: 'search_code', description: 'search the codebase for a word; returns matching file paths', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, actionClass: 'read-only', execute: () => 'src/net/retry.ts (line 12: function withRetry), src/net/client.ts' })
  ctx.tools.register({ name: 'read_file', description: 'read a file by path', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, actionClass: 'read-only', execute: () => 'export function withRetry(fn, max = 3) { /* retries fn up to max times with exponential backoff, rethrows the last error */ }' })
  await ctx.plugin(SubagentScope)
  await ctx.plugin(Orchestrator, {})
  const sid = `t${n}`
  let plan
  try {
    plan = (await ctx.orchestrator.plan({ sessionId: sid, task, tools: TOOLS, provider: 'planner' })).plan
  } catch (e) {
    if (!(e instanceof PlanError)) throw e
    return { planned: false as const, why: e.errors.join('; ') }
  }
  const r = await ctx.orchestrator.execute(plan, { sessionId: sid, allowedTools: TOOLS, onFailure: ON_FAILURE, retries: RETRIES, maxSteps: 6, provider: 'worker' })
  const toolCalls = (await ctx.log.read(sid)).filter((e) => e.type === 'tool.call').length
  return { planned: true as const, r, toolCalls, subtaskCount: plan.subtasks.length }
}

console.log(STAND_IN ? '(STAND-IN, not a measurement of any model)' : `planner=${plannerModel} worker=${workerModel}  n=${TRIALS} trials x ${TASKS.length} tasks  onFailure=${ON_FAILURE} retries=${RETRIES}`)
const providers = (): [LLMProvider, LLMProvider] => {
  if (STAND_IN) {
    const m = new MockProvider(((req: any) => (String(req.system ?? '').includes('You are a planner') ? { text: STAND_PLAN } : { text: 'a canned answer' })) as any)
    return [m, m]
  }
  return [new OllamaProvider({ model: plannerModel!, timeoutMs: 300_000 }), new OllamaProvider({ model: workerModel!, timeoutMs: 300_000 })]
}
const [planner, worker] = providers()
if (!STAND_IN) {
  try {
    const installed = await (planner as OllamaProvider).listModels()
    for (const m of new Set([plannerModel!, workerModel!])) {
      if (!installed.some((n) => n === m || n === `${m}:latest`)) throw new Error(`model "${m}" is not installed. Installed: ${installed.join(', ') || '(none)'}`)
    }
  } catch (e: any) {
    console.error(e?.message ?? e)
    process.exit(1)
  }
}

let planned = 0, fullyCompleted = 0, calls = 0
const statusCounts: Record<string, number> = {}
const reasons = new Map<string, number>()
let sample = ''
let n = 0
for (let i = 0; i < TRIALS; i++) {
  for (const task of TASKS) {
    process.stdout.write('.')
    const t = await trial(planner, worker, task, n++)
    if (!t.planned) {
      reasons.set('plan: ' + t.why.replace(/"[^"]*"/g, '"…"').slice(0, 90), (reasons.get('plan: ' + t.why.replace(/"[^"]*"/g, '"…"').slice(0, 90)) ?? 0) + 1)
      continue
    }
    planned++
    calls += t.toolCalls
    if (t.r.status === 'completed') fullyCompleted++
    for (const s of t.r.subtasks) {
      statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1
      if (s.reason) reasons.set(s.reason.slice(0, 90), (reasons.get(s.reason.slice(0, 90)) ?? 0) + 1)
    }
    if (!sample) sample = JSON.stringify(t.r.subtasks.map((s) => ({ id: s.id, status: s.status, text: s.text?.slice(0, 80), reason: s.reason })))
  }
}
const total = TRIALS * TASKS.length
console.log(`\n\n  trials ${total}: plan valid ${planned}/${total}   run fully completed ${fullyCompleted}/${total}   real tool calls made by workers: ${calls}`)
console.log(`  subtask statuses: ${JSON.stringify(statusCounts)}`)
for (const [k, v] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`  x${v}: ${k}`)
console.log(`  sample: ${sample.slice(0, 500)}`)
console.log('\nThese are counts from a few samples, not rates. Paste this whole output back; do not summarise it.')
