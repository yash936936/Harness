/**
 * 4.5 success criterion 2: does each decision class the router would own match or beat the worker on the frozen suite?
 *   npx tsx scripts/eval-router.ts                       (rules vs worker; worker = qwen2.5-coder:3b-instruct via Ollama)
 *   HARNESS_ROUTER_WORKER=qwen2.5-coder:7b-instruct npx tsx scripts/eval-router.ts
 *   HARNESS_ROUTER_CMD="python needle_wrapper.py" HARNESS_ROUTER_FILES="models/needle2/needle2.cact" npx tsx scripts/eval-router.ts
 * HARNESS_ROUTER_CMD is YOUR Needle wrapper speaking the stdio contract in src/bundles/router/backends.ts (one JSON line in,
 * one JSON line out). This repo does not ship it: how Cactus loads a .cact file is unverified (D-050).
 * HARNESS_STANDIN=1 self-tests the script with a fake worker (NOT a measurement). Prints one verdict per class per backend;
 * a class goes into `router.owned` only on `OWNS`. Paste the whole output back, do not summarise it.
 */
import { mkdirSync, mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootProfileCoding } from '../src/profiles/profile-coding.js'
import { MockProvider, OllamaProvider } from '../src/bundles/model-adapter/index.js'
import { CommandBackend, DECISION_CLASSES, RulesBackend, SUITE, WorkerBackend, evaluateClass, suiteSha256, verdict, type RouterBackend } from '../src/bundles/router/index.js'

const STAND_IN = process.env['HARNESS_STANDIN'] === '1'
const root = realpathSync(mkdtempSync(join(tmpdir(), 'harness-eval-router-')))
mkdirSync(join(root, 'src'))
try {
  const ctx = await bootProfileCoding({ projectId: 'eval-router', projectRoot: root, sessionLog: { memory: true } })
  const model = process.env['HARNESS_ROUTER_WORKER'] ?? 'qwen2.5-coder:3b-instruct'
  ctx.llm.register('worker', STAND_IN
    ? new MockProvider((() => ({ text: 'coder', stopReason: 'end_turn' })) as any)
    : new OllamaProvider({ model, timeoutMs: 300_000, textToolCalls: /qwen/i.test(model) }), { default: true })
  const backends: RouterBackend[] = [new RulesBackend()]
  if (process.env['HARNESS_ROUTER_CMD']) {
    const [command, ...args] = process.env['HARNESS_ROUTER_CMD'].split(' ')
    backends.push(new CommandBackend({ command: command!, args, requiredFiles: process.env['HARNESS_ROUTER_FILES']?.split(','), timeoutMs: 30_000 }))
  }
  const worker = new WorkerBackend({ complete: (r) => ctx.llm.complete(r as any) }, 'eval-router')
  console.log(STAND_IN ? '(STAND-IN: self-test of this script, NOT a measurement)' : `worker: ${model}   suite sha256: ${suiteSha256().slice(0, 12)}…  ${SUITE.agent.cases.length} cases per class (labels by one author; counts, not rates)`)
  for (const cls of DECISION_CLASSES) {
    const w = await evaluateClass(worker, cls)
    console.log(`\n[${cls}]  worker  ${w.correct}/${w.cases} correct, ${w.abstained} abstained, ${w.errors} errors, ${w.avgLatencyMs} ms avg, ${w.requests} requests`)
    for (const b of backends) {
      if (b.available) {
        const a = await b.available()
        if (!a.ok) { console.log(`        ${b.name.padEnd(7)} SKIPPED: ${a.why}`); continue }
      }
      const r = await evaluateClass(b, cls)
      const v = verdict(r, w)
      console.log(`        ${b.name.padEnd(7)} ${r.correct}/${r.cases} correct, ${r.abstained} abstained, ${r.errors} errors, ${r.avgLatencyMs} ms avg, ${r.requests} requests   -> ${v.owns ? 'OWNS' : 'worker keeps it'} (${v.reason})`)
    }
  }
  console.log('\n"rules" is the always-available fallback; only a Needle row marked OWNS justifies adding that class to router.owned. Not measured here: real traffic, longer tasks, other phrasings.')
} finally {
  rmSync(root, { recursive: true, force: true })
}
