/**
 * Real-model check for Phases 1-3: does a real local chat model, driven by the
 * real agent loop, (A) call tools correctly, (B) change behaviour because of a
 * rule in its hot-memory tier, (C) use skills (model-driven `load_skill`, and the
 * optional host-side auto-load)?
 *
 *   HARNESS_OLLAMA_CHAT_MODEL=qwen2.5-coder:3b-instruct npx tsx scripts/smoke-real-model.ts
 *   HARNESS_OLLAMA_CHAT_MODEL=qwen2.5-coder:3b-instruct,llama3.2:3b HARNESS_TRIALS=3 npx tsx scripts/smoke-real-model.ts
 *
 * Other settings: HARNESS_TRIALS (default 5), HARNESS_EXPERIMENTS (default A,B,C), OLLAMA_HOST.
 * Without HARNESS_OLLAMA_CHAT_MODEL it runs a deterministic STAND-IN so the script itself can be
 * tested; that output is not a measurement of any model.
 *
 * READ THE NUMBERS HONESTLY. The model samples at Ollama's default temperature, so trials differ.
 * With a handful of trials, a difference of one trial is noise, and if the baseline already does the
 * right thing there is no room for memory to show an effect. The script says so when that happens.
 * Nothing here is pass/fail: it prints counts. It exits non-zero only if it could not run at all.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from 'cordis'
import { AgentLoop } from '../src/bundles/agent-loop/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { Memory } from '../src/bundles/memory/index.js'
import { LLMService, MockProvider, OllamaProvider, type LLMProvider } from '../src/bundles/model-adapter/index.js'
import { SessionLog, type SessionEvent } from '../src/bundles/session-log/index.js'
import { LOAD_TOOL, Skills, keywordMatcher } from '../src/bundles/skills/index.js'
import { ToolRegistry } from '../src/bundles/tool-registry/index.js'

const models = (process.env['HARNESS_OLLAMA_CHAT_MODEL'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const TRIALS = Math.max(1, Number(process.env['HARNESS_TRIALS'] ?? 5) || 5)
const WANT = new Set((process.env['HARNESS_EXPERIMENTS'] ?? 'A,B,C').toUpperCase().split(',').map((s) => s.trim()))
const STAND_IN = models.length === 0

const BASE_SYSTEM = 'You are a coding assistant. Use the tools you are given when they help. Keep answers short.'
const RULE = 'Run the typecheck before running the tests.'
const CODE = 'ZX-9931'
const TASK_A = 'What port does the dev server listen on? Use the lookup_port tool to find out, then tell me the number.'
const TASK_B = 'Run the tests for the billing module and tell me whether they pass.'
const TASK_C = 'Cut a release of the staging service the way our team does it, then tell me the release code.'

// ---- a deterministic stand-in, ONLY to self-test this script ----------------------------------------
function standIn(req: { system?: string | undefined; messages: unknown[]; tools?: { name: string }[] }) {
  const names = new Set((req.tools ?? []).map((t) => t.name))
  const system = req.system ?? ''
  const seen = JSON.stringify(req.messages)
  const use = (id: string, name: string, input: unknown) => ({ toolCalls: [{ id, name, input }], content: [{ type: 'tool_use' as const, id, name, input }] })
  if (names.has('lookup_port')) return seen.includes('RESULT lookup_port') ? { text: 'The dev server listens on 7421.' } : use('a', 'lookup_port', { service: 'dev' })
  if (names.has('run_tests')) {
    if (/typecheck before (?:running )?(?:the )?tests/i.test(system) && !seen.includes('RESULT typecheck')) return use('t', 'typecheck', {})
    if (!seen.includes('RESULT run_tests')) return use('r', 'run_tests', { module: 'billing' })
    return { text: seen.includes('FAILED') ? 'The tests failed.' : 'The tests pass.' }
  }
  if (system.includes(CODE) || seen.includes(CODE)) return { text: `Release code: ${CODE}` }
  if (names.has(LOAD_TOOL) && system.includes('release-procedure')) return use('l', LOAD_TOOL, { name: 'release-procedure' })
  return { text: 'I do not know the release code.' }
}

// ---- one trial ----------------------------------------------------------------------------------------
type Exp = 'A' | 'B-baseline' | 'B-rule' | 'C-control' | 'C-index' | 'C-auto'
interface Trial {
  ok: boolean
  error?: string
  ms: number
  steps: number
  tools: string[]
  failedTool: boolean
  finalText: string
}

const evText = (e: SessionEvent) => String((e.data as { content?: unknown }).content ?? '')

async function trial(exp: Exp, provider: LLMProvider, skillsDir: string): Promise<Trial> {
  const t0 = Date.now()
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(EgressPolicy, { projectId: 'real-model' })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LLMService, {})
  ctx.llm.register('chat', provider, { default: true })
  let typechecked = false
  const A = exp === 'A'
  const B = exp.startsWith('B')
  if (A) {
    ctx.tools.register({
      name: 'lookup_port',
      description: 'Look up the network port a named service listens on.',
      actionClass: 'read-only',
      inputSchema: { type: 'object', properties: { service: { type: 'string', description: 'service name, e.g. dev' } }, required: ['service'] },
      execute: () => 'RESULT lookup_port: the dev server listens on port 7421',
    })
  }
  if (B) {
    ctx.tools.register({ name: 'typecheck', description: 'Type-check the project. Must succeed before tests can pass.', actionClass: 'sandbox-write', inputSchema: { type: 'object', properties: {} }, execute: () => ((typechecked = true), 'RESULT typecheck: OK') })
    ctx.tools.register({
      name: 'run_tests',
      description: 'Run the tests of one module.',
      actionClass: 'sandbox-write',
      inputSchema: { type: 'object', properties: { module: { type: 'string', description: 'module name' } }, required: ['module'] },
      execute: (i: { module?: string }) => (typechecked ? `RESULT run_tests: PASSED (${i.module ?? '?'}: 12 tests)` : 'RESULT run_tests: FAILED, stale type output; run the typecheck first'),
    })
  }
  await ctx.plugin(AgentLoop, { sleep: async () => {}, retry: { maxAttempts: 1 }, system: BASE_SYSTEM })
  if (B) {
    await ctx.plugin(Memory, {})
    if (exp === 'B-rule') await ctx.memory.hot.add({ text: RULE, priority: 1 })
  }
  if (exp === 'C-index') await ctx.plugin(Skills, { dirs: [skillsDir] })
  if (exp === 'C-auto') await ctx.plugin(Skills, { dirs: [skillsDir], autoLoad: { matcher: keywordMatcher() } })

  const sessionId = ctx.log.create('trial')
  const prompt = A ? TASK_A : B ? TASK_B : TASK_C
  try {
    const r = await ctx.agentLoop.run({ sessionId, prompt, maxSteps: 8 })
    const log = await ctx.log.read(sessionId)
    return {
      ok: true,
      ms: Date.now() - t0,
      steps: r.steps,
      tools: log.filter((e) => e.type === 'tool.call').map((e) => String((e.data as { name?: unknown }).name)),
      failedTool: log.some((e) => e.type === 'tool.result' && evText(e).includes('FAILED')),
      finalText: r.finalText,
    }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e), ms: Date.now() - t0, steps: 0, tools: [], failedTool: false, finalText: '' }
  }
}

const k = (n: number, d: number) => `${n}/${d}`
const count = <T,>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length

async function runModel(label: string, provider: LLMProvider, skillsDir: string) {
  console.log(`\n=== ${label}  (n=${TRIALS} per condition) ===`)
  const results = {} as Record<Exp, Trial[]>
  const plan: Exp[] = [...(WANT.has('A') ? (['A'] as Exp[]) : []), ...(WANT.has('B') ? (['B-baseline', 'B-rule'] as Exp[]) : []), ...(WANT.has('C') ? (['C-control', 'C-index', 'C-auto'] as Exp[]) : [])]
  for (const exp of plan) {
    results[exp] = []
    process.stdout.write(`  ${exp.padEnd(10)} `)
    for (let i = 0; i < TRIALS; i++) {
      const t = await trial(exp, provider, skillsDir)
      results[exp].push(t)
      process.stdout.write(t.ok ? `.(${(t.ms / 1000).toFixed(0)}s) ` : `E `)
    }
    process.stdout.write('\n')
  }
  const errors = Object.values(results).flat().filter((t) => !t.ok)
  const lines: string[] = []
  const ok = (e: Exp) => results[e]!.filter((t) => t.ok)
  if (results['A']) {
    const t = ok('A')
    lines.push(`A  tool use          called lookup_port ${k(count(t, (x) => x.tools.includes('lookup_port')), t.length)}   answer contains 7421 ${k(count(t, (x) => x.finalText.includes('7421')), t.length)}`)
  }
  if (results['B-baseline'] && results['B-rule']) {
    const b = ok('B-baseline'), r = ok('B-rule')
    const first = (t: Trial) => t.tools[0] === 'typecheck'
    lines.push(`B  no rule           typecheck first ${k(count(b, first), b.length)}   a tool call failed ${k(count(b, (x) => x.failedTool), b.length)}`)
    lines.push(`B  with hot rule     typecheck first ${k(count(r, first), r.length)}   a tool call failed ${k(count(r, (x) => x.failedTool), r.length)}`)
    const base = count(b, first), withRule = count(r, first)
    const note =
      b.length === 0 || r.length === 0 ? 'no completed trials to compare'
      : base >= Math.ceil(b.length * 0.8) ? 'NO HEADROOM: the model already typechecks first without the rule, so this cannot show an effect'
      : withRule - base >= 2 ? `the rule went with ${withRule - base} more typecheck-first trials; still a small sample`
      : 'NO CLEAR EFFECT at this sample size (a difference of one trial is noise)'
    lines.push(`   -> ${note}`)
  }
  if (results['C-control'] && results['C-index'] && results['C-auto']) {
    const c0 = ok('C-control'), c1 = ok('C-index'), c2 = ok('C-auto')
    const has = (t: Trial) => t.finalText.includes(CODE)
    lines.push(`C  no skills         code in answer ${k(count(c0, has), c0.length)}   (the code is unguessable: anything above 0 means the answer is not coming from the skill)`)
    lines.push(`C  index only        load_skill called ${k(count(c1, (x) => x.tools.includes(LOAD_TOOL)), c1.length)}   code in answer ${k(count(c1, has), c1.length)}   (the model must decide to load the skill itself)`)
    lines.push(`C  auto-load         code in answer ${k(count(c2, has), c2.length)}   (host puts the instructions in the system prompt)`)
  }
  console.log('\n  RESULTS')
  for (const l of lines) console.log('  ' + l)
  if (errors.length) console.log(`  ${errors.length} trial(s) errored, e.g.: ${errors[0]!.error}`)
  // a few raw answers, so the numbers can be checked by eye
  for (const exp of Object.keys(results) as Exp[]) {
    const t = ok(exp)[0]
    if (t) console.log(`  sample ${exp}: tools=[${t.tools.join(', ')}] answer="${t.finalText.replace(/\s+/g, ' ').slice(0, 160)}"`)
  }
}

const base = realpathSync(mkdtempSync(join(tmpdir(), 'harness-realmodel-')))
const skillsDir = join(base, 'skills')
mkdirSync(join(skillsDir, 'release-procedure'), { recursive: true })
writeFileSync(
  join(skillsDir, 'release-procedure', 'SKILL.md'),
  `---\nname: release-procedure\ndescription: How our team cuts a release of the staging service, including the release code to announce.\n---\n\n# Release procedure\n\n1. Confirm the checks are green.\n2. Announce the release code ${CODE} in your final answer.\n`,
)
try {
  if (STAND_IN) {
    console.log('STAND-IN MODE: no HARNESS_OLLAMA_CHAT_MODEL set. This tests the script, it measures no model.')
    await runModel('stand-in (deterministic)', new MockProvider(standIn as never), skillsDir)
  } else {
    for (const m of models) {
      const provider = new OllamaProvider({ model: m, timeoutMs: 300_000 })
      try {
        const installed = await provider.listModels()
        if (!installed.some((n) => n === m || n === `${m}:latest`)) {
          console.error(`model "${m}" is not installed. Installed: ${installed.join(', ') || '(none)'}. Run: ollama pull ${m}`)
          process.exitCode = 1
          continue
        }
      } catch (e: any) {
        console.error(`cannot reach Ollama: ${e?.message ?? e}. Start it with \`ollama serve\`.`)
        process.exitCode = 1
        break
      }
      await runModel(`ollama / ${m}`, provider, skillsDir)
    }
  }
} finally {
  rmSync(base, { recursive: true, force: true })
}
console.log('\nThese are counts from a few samples, not rates. Paste this whole output back; do not summarise it.')
