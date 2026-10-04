/**
 * Real-model check for 4.1: can a real local model produce a plan that passes the planner's schema?
 *
 *   HARNESS_OLLAMA_CHAT_MODEL=llama3.2:3b HARNESS_TRIALS=3 npx tsx scripts/smoke-plan.ts
 *   HARNESS_OLLAMA_CHAT_MODEL=qwen2.5-coder:3b-instruct,llama3.2:3b npx tsx scripts/smoke-plan.ts
 *
 * Counts, per model and task: accepted first try / accepted after the one repair / rejected. Plus the
 * errors the planner raised, most common first, and one sample plan or failure. It checks that a plan is
 * VALID (shape, known tools, earlier-only dependencies); it does NOT judge whether the plan is GOOD.
 * Not pass/fail: exits non-zero only if it could not run. Without HARNESS_OLLAMA_CHAT_MODEL it runs a
 * deterministic stand-in to self-test the script; that is not a measurement of any model.
 * With a handful of trials, a difference of one is noise.
 */
import { Context } from 'cordis'
import { AgentLoop } from '../src/bundles/agent-loop/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { LLMService, MockProvider, OllamaProvider, type LLMProvider } from '../src/bundles/model-adapter/index.js'
import { Orchestrator, PlanError } from '../src/bundles/orchestrator/index.js'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { ToolRegistry } from '../src/bundles/tool-registry/index.js'

const models = (process.env['HARNESS_OLLAMA_CHAT_MODEL'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const TRIALS = Math.max(1, Number(process.env['HARNESS_TRIALS'] ?? 3) || 3)
const STAND_IN = models.length === 0
const TASKS = [
  'Find where the retry logic lives, explain how it works, and add a unit test for the case where all retries fail.',
  'Rename the function parseConfig to loadConfig everywhere and make sure the tests still pass.',
  'Summarise what the session-log module does.',
]
const GOOD = JSON.stringify({ subtasks: [{ id: 's1', goal: 'find the code', tools: ['search_code'] }, { id: 's2', goal: 'read it', tools: ['read_file'], dependsOn: ['s1'] }] })

async function run(provider: LLMProvider) {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(EgressPolicy, { projectId: 'smoke-plan' })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LLMService, {})
  ctx.llm.register('p', provider, { default: true })
  await ctx.plugin(AgentLoop, {})
  for (const [name, actionClass] of [['search_code', 'read-only'], ['read_file', 'read-only'], ['edit_file', 'real-fs-write'], ['run_tests', 'sandbox-write']] as const)
    ctx.tools.register({ name, description: `${name.replace('_', ' ')}`, inputSchema: { type: 'object' }, actionClass, execute: () => 'ok' })
  await ctx.plugin(Orchestrator, {})
  const out = { first: 0, repaired: 0, rejected: 0, errors: new Map<string, number>(), sample: '' }
  for (let i = 0; i < TRIALS; i++) {
    for (const task of TASKS) {
      process.stdout.write('.')
      try {
        const r = await ctx.orchestrator.plan({ sessionId: `s${i}-${TASKS.indexOf(task)}`, task })
        if (r.attempts === 1) out.first++
        else out.repaired++
        if (!out.sample) out.sample = JSON.stringify(r.plan.subtasks)
      } catch (e) {
        if (!(e instanceof PlanError)) throw e
        out.rejected++
        for (const m of e.errors) {
          const key = m.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, 'N')
          out.errors.set(key, (out.errors.get(key) ?? 0) + 1)
        }
        if (!out.sample) out.sample = `REJECTED: ${e.errors.join('; ')}`
      }
    }
  }
  return out
}

console.log(STAND_IN ? '(STAND-IN, not a measurement of any model)' : `n=${TRIALS} trials x ${TASKS.length} tasks per model`)
for (const m of STAND_IN ? ['stand-in'] : models) {
  const provider = STAND_IN ? new MockProvider(() => ({ text: GOOD })) : new OllamaProvider({ model: m, timeoutMs: 300_000 })
  if (!STAND_IN) {
    try {
      const installed = await (provider as OllamaProvider).listModels()
      if (!installed.some((n) => n === m || n === `${m}:latest`)) {
        console.error(`model "${m}" is not installed. Installed: ${installed.join(', ') || '(none)'}`)
        process.exitCode = 1
        continue
      }
    } catch (e: any) {
      console.error(`cannot reach Ollama: ${e?.message ?? e}`)
      process.exitCode = 1
      continue
    }
  }
  const r = await run(provider)
  const total = TRIALS * TASKS.length
  console.log(`\n=== ${m} ===\n  accepted first try ${r.first}/${total}   accepted after repair ${r.repaired}/${total}   rejected ${r.rejected}/${total}`)
  for (const [k, v] of [...r.errors].sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`  error x${v}: ${k}`)
  console.log(`  sample: ${r.sample.slice(0, 400)}`)
}
console.log('\nThese are counts from a few samples, not rates. Paste this whole output back; do not summarise it.')
