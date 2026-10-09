/**
 * First real-model run on `profile-coding` (open item 5). What it measures, per model, on a tiny temp project with a known bug:
 *   - can the model drive the REAL tools: does it produce valid `edit_file` / `write_file` input, how often is a call rejected by the schema or fails to run;
 *   - does it report a `confidence`, and what values; what the gate then did (allow-logged / hold / deny);
 *   - is the RESULT objectively right (the fixed file is imported and called; the created file likewise; the read answer is compared to the known value);
 *   - did any tool result get flagged by input-guard (it should not: the fixture has no hostile text), and what lesson, if any, the turn left.
 *
 *   HARNESS_CODING_MODELS=llama3.2:3b,qwen2.5-coder:3b-instruct HARNESS_TRIALS=3 npx tsx scripts/smoke-coding.ts
 *   HARNESS_STANDIN=1 npx tsx scripts/smoke-coding.ts        (deterministic stand-in: self-tests THIS SCRIPT, measures no model)
 *   HARNESS_STANDIN=noop ...                                 (does nothing: every task must score 0, proving the checks can fail)
 *
 * The approver here AUTO-APPROVES every hold and records it, so a task can finish; that is safe only because every trial works in a throwaway
 * temp directory. A hold is therefore a COUNT of how often a human would have been asked, not a failure. A few trials are counts, not rates.
 * Not measured here: plan quality, multi-agent runs, long tasks, a project bigger than three files.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bootProfileCoding } from '../src/profiles/profile-coding.js'
import { MockProvider, OllamaProvider, type LLMProvider } from '../src/bundles/model-adapter/index.js'
import type { SessionEvent } from '../src/bundles/session-log/index.js'

const STAND_IN = process.env['HARNESS_STANDIN'] === '1' || process.env['HARNESS_STANDIN'] === 'noop'
const NOOP = process.env['HARNESS_STANDIN'] === 'noop'
const MODELS = (process.env['HARNESS_CODING_MODELS'] ?? 'llama3.2:3b,qwen2.5-coder:3b-instruct').split(',').map((s) => s.trim()).filter(Boolean)
const TRIALS = Math.max(1, Number(process.env['HARNESS_TRIALS'] ?? 3) || 3)
const TOOLS = ['read_file', 'edit_file', 'write_file']

const MATH = 'export const LIMIT = 4172\n\nexport function add(a, b) {\n  return a - b\n}\n\nexport function multiply(a, b) {\n  return a * b\n}\n'
const load = async (root: string, rel: string) => import(pathToFileURL(join(root, rel)).href + `?t=${Date.now()}${Math.random()}`)
const LAYOUT = 'The project has these files: package.json, src/math.js. Paths are relative to the project root.'

interface Task {
  id: string
  prompt: string
  check(root: string, finalText: string): Promise<boolean>
}
const TASKS: Task[] = [
  {
    id: 'fix',
    prompt: `${LAYOUT} The function add in src/math.js has a bug: it should return the sum of a and b. Read the file, then fix the bug by editing it.`,
    check: async (root) => {
      const m = await load(root, 'src/math.js')
      return m.add(2, 3) === 5 && m.add(10, 5) === 15 && m.multiply(4, 5) === 20 // and nothing else broken
    },
  },
  {
    id: 'create',
    prompt: `${LAYOUT} Create a new file src/greet.js that exports a function greet(name) returning the string "Hello, " followed by the name. Use ES module syntax (export function).`,
    check: async (root) => {
      if (!existsSync(join(root, 'src', 'greet.js'))) return false
      const m = await load(root, 'src/greet.js')
      return typeof m.greet === 'function' && m.greet('Sam') === 'Hello, Sam'
    },
  },
  {
    id: 'read',
    prompt: `${LAYOUT} Read src/math.js and tell me the value of the constant LIMIT. Answer with just the number.`,
    // 4172 cannot be guessed: the answer is right only if the file was actually read (the first version asked for multiply(4,5), which is 20 without reading anything).
    check: async (root, text) => /\b4172\b/.test(text) && readFileSync(join(root, 'src', 'math.js'), 'utf8') === MATH,
  },
]

function standIn(): LLMProvider {
  const turns = (m: any[]) => m.filter((x) => x.role === 'assistant').length
  const call = (m: any[], name: string, input: unknown) => ({ toolCalls: [{ id: `c${turns(m)}`, name, input }], content: [{ type: 'tool_use', id: `c${turns(m)}`, name, input }] }) as any
  if (NOOP) return new MockProvider((() => ({ text: 'nothing to do', stopReason: 'end_turn' })) as any) // negative control: every check below must FAIL
  return new MockProvider(((req: any) => {
    const m = req.messages
    const prompt = String(typeof m[0].content === 'string' ? m[0].content : '')
    const t = turns(m)
    if (prompt.includes('has a bug')) return t === 0 ? call(m, 'read_file', { path: 'src/math.js' }) : t === 1 ? call(m, 'edit_file', { path: 'src/math.js', old_string: 'return a - b', new_string: 'return a + b', confidence: 0.9 }) : { text: 'fixed', stopReason: 'end_turn' }
    if (prompt.includes('Create a new file')) return t === 0 ? call(m, 'write_file', { path: 'src/greet.js', content: 'export function greet(name) {\n  return "Hello, " + name\n}\n', confidence: 0.9 }) : { text: 'created', stopReason: 'end_turn' }
    return t === 0 ? call(m, 'read_file', { path: 'src/math.js' }) : { text: '4172', stopReason: 'end_turn' }
  }) as any)
}

interface Trial {
  task: string
  passed: boolean
  outcome: string
  steps: number
  ms: number
  calls: Record<string, number>
  failures: { tool: string; kind: string; msg: string; input: string }[]
  confidences: (number | null)[]
  writes: { tool: string; conf: number | null; ok: boolean }[]
  detail: string
  okWrites: string[]
  verdicts: Record<string, number>
  holdReasons: string[]
  flagged: number
  lesson: string | null
  error?: string
}

function measure(events: SessionEvent[]) {
  const calls: Record<string, number> = {}
  const failures: Trial['failures'] = []
  const confidences: (number | null)[] = []
  const verdicts: Record<string, number> = {}
  const holdReasons: string[] = []
  const writes: Trial['writes'] = []
  const okWrites: string[] = []
  let last: { name: string; input: any } | undefined
  for (const e of events) {
    const d = e.data as any
    if (e.type === 'tool.call') {
      last = { name: d.name, input: d.input }
      calls[d.name] = (calls[d.name] ?? 0) + 1
      if (d.name === 'edit_file' || d.name === 'write_file') confidences.push(typeof d.input?.confidence === 'number' ? d.input.confidence : null)
    } else if (e.type === 'tool.result') {
      if (d.ok === true && last && (last.name === 'edit_file' || last.name === 'write_file')) okWrites.push(`${last.name} ${last.input?.path} (${String(last.input?.content ?? last.input?.new_string ?? '').length} chars)`)
      if (last && (last.name === 'edit_file' || last.name === 'write_file')) writes.push({ tool: last.name, conf: typeof last.input?.confidence === 'number' ? last.input.confidence : null, ok: d.ok === true })
      if (d.ok === false) failures.push({ tool: d.name, kind: d.errorKind ?? '?', msg: String(d.content).replace(/\s+/g, ' ').slice(0, 160), input: JSON.stringify(last?.input ?? null).slice(0, 220) })
    }
    else if (e.type === 'policy.decision') {
      verdicts[d.verdict] = (verdicts[d.verdict] ?? 0) + 1
      if (d.verdict === 'hold') holdReasons.push(String(d.reason).slice(0, 110))
    }
  }
  return { calls, failures, confidences, writes, okWrites, verdicts, holdReasons, flagged: events.filter((e) => e.type === 'input.flagged').length }
}

async function runTrial(provider: LLMProvider, task: Task, n: number): Promise<Trial> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'harness-smoke-coding-')))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'package.json'), '{"name":"fixture","type":"module"}\n')
  writeFileSync(join(root, 'src', 'math.js'), MATH)
  const start = Date.now()
  const sid = `c${n}`
  const snap = (rel: string) => (existsSync(join(root, rel)) ? JSON.stringify(readFileSync(join(root, rel), 'utf8').slice(0, 130)) : '(missing)')
  try {
    const ctx = await bootProfileCoding({
      projectId: 'smoke-coding',
      projectRoot: root,
      sessionLog: { memory: true },
      agentLoop: { maxSteps: 10 },
      policy: { approvalTimeoutMs: 5000, approver: () => ({ approve: true, by: 'smoke-auto' }) },
    })
    ctx.llm.register('m', provider, { default: true })
    let finalText = ''
    let outcome = 'done'
    let steps = 0
    let lesson: string | null = null
    let error: string | undefined
    try {
      const r = await ctx.memory.runTurn({ sessionId: sid, prompt: task.prompt, tools: TOOLS })
      finalText = r.finalText
      outcome = r.stopReason
      steps = r.steps ?? 0
      lesson = r.episode.lesson
    } catch (e: any) {
      outcome = 'error'
      error = String(e?.message ?? e).slice(0, 200)
    }
    const m = measure(await ctx.log.read(sid))
    let passed = false
    try {
      passed = await task.check(root, finalText)
    } catch {
      passed = false
    }
    const said = `final=${JSON.stringify(finalText.slice(0, 160))}`
    const detail = passed ? '' : task.id === 'create' ? `greet.js=${snap('src/greet.js')} ${said}` : task.id === 'fix' ? `math.js=${snap('src/math.js')} ${said}` : `answer=${JSON.stringify(finalText.slice(0, 100))} math.js ${readFileSync(join(root, 'src', 'math.js'), 'utf8') === MATH ? 'unchanged' : 'CHANGED'}`
    return { task: task.id, passed, outcome, steps, ms: Date.now() - start, ...m, detail, lesson, ...(error ? { error } : {}) }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const pct = (a: number, b: number) => (b ? `${a}/${b}` : '0/0')
async function main() {
  console.log(STAND_IN ? '(STAND-IN: self-test of this script, NOT a measurement of any model)' : `models=${MODELS.join(', ')}  trials=${TRIALS} x ${TASKS.length} tasks each`)
  const subjects: [string, LLMProvider][] = STAND_IN ? [['stand-in', standIn()]] : MODELS.map((m) => [m, new OllamaProvider({ model: m, timeoutMs: 300_000, textToolCalls: /qwen/i.test(m) })])
  if (!STAND_IN) {
    try {
      const installed = await (subjects[0]![1] as OllamaProvider).listModels()
      for (const [m] of subjects) if (!installed.some((n) => n === m || n === `${m}:latest`)) throw new Error(`model "${m}" is not installed. Installed: ${installed.join(', ') || '(none)'}`)
    } catch (e: any) {
      console.error(e?.message ?? e)
      process.exit(1)
    }
  }
  let n = 0
  for (const [name, provider] of subjects) {
    const trials: Trial[] = []
    for (let i = 0; i < TRIALS; i++) for (const task of TASKS) {
      process.stdout.write('.')
      trials.push(await runTrial(provider, task, n++))
    }
    console.log(`\n\n=== ${name} ===`)
    for (const t of TASKS) {
      const ts = trials.filter((x) => x.task === t.id)
      console.log(`  ${t.id.padEnd(7)} correct ${pct(ts.filter((x) => x.passed).length, ts.length)}   outcomes ${JSON.stringify(ts.reduce((a: any, x) => ((a[x.outcome] = (a[x.outcome] ?? 0) + 1), a), {}))}   avg steps ${(ts.reduce((s, x) => s + x.steps, 0) / ts.length).toFixed(1)}   avg ${(ts.reduce((s, x) => s + x.ms, 0) / ts.length / 1000).toFixed(1)}s`)
    }
    const sum = (f: (t: Trial) => number) => trials.reduce((s, t) => s + f(t), 0)
    const callsOf = (tool: string) => sum((t) => t.calls[tool] ?? 0)
    const failOf = (tool: string, kind?: string) => sum((t) => t.failures.filter((f) => f.tool === tool && (!kind || f.kind === kind)).length)
    for (const tool of ['read_file', 'edit_file', 'write_file']) console.log(`  ${tool.padEnd(10)} calls ${callsOf(tool)}   failed ${failOf(tool)} (invalid_input ${failOf(tool, 'invalid_input')}, execution ${failOf(tool, 'execution')})`)
    const unknown = sum((t) => t.failures.filter((f) => f.kind === 'unknown_tool').length)
    const confs = trials.flatMap((t) => t.confidences)
    const given = confs.filter((c): c is number => c !== null)
    console.log(`  tool calls to unknown/unoffered tools: ${unknown}`)
    console.log(`  confidence reported on ${given.length}/${confs.length} write calls${given.length ? `; values ${JSON.stringify(given.slice(0, 12))}` : ''}`)
    const verd: Record<string, number> = {}
    for (const t of trials) for (const [k, v] of Object.entries(t.verdicts)) verd[k] = (verd[k] ?? 0) + v
    console.log(`  gate decisions: ${JSON.stringify(verd)}   (holds were auto-approved here; each is one time a person would have been asked)`)
    const reasons = new Map<string, number>()
    for (const t of trials) for (const r of t.holdReasons) reasons.set(r, (reasons.get(r) ?? 0) + 1)
    for (const [r, c] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 3)) console.log(`    x${c} hold: ${r}`)
    console.log(`  input-guard flags: ${sum((t) => t.flagged)} (expected 0: the fixture has no hostile text)`)
    const lessons = new Map<string, number>()
    for (const t of trials) if (t.lesson) lessons.set(t.lesson, (lessons.get(t.lesson) ?? 0) + 1)
    for (const [l, c] of lessons) console.log(`  lesson x${c}: ${l}`)
    const fails = new Map<string, number>()
    for (const t of trials) for (const f of t.failures) fails.set(`${f.tool}/${f.kind}: ${f.msg}`, (fails.get(`${f.tool}/${f.kind}: ${f.msg}`) ?? 0) + 1)
    for (const [f, c] of [...fails].sort((a, b) => b[1] - a[1]).slice(0, 4)) console.log(`    x${c} ${f}`)
    // The cause of each failure, not just its kind: what the model actually sent, and whether its self-reported confidence told us anything.
    for (const t of trials) for (const f of t.failures.slice(0, 2)) console.log(`    [${t.task}] ${f.tool} sent ${f.input}`)
    const w = trials.flatMap((t) => t.writes)
    const wc = w.filter((x) => x.conf !== null)
    console.log(`  write calls: ${w.filter((x) => x.ok).length}/${w.length} ran ok. With a confidence: ${wc.filter((x) => x.ok).length}/${wc.length} ok (mean ${wc.length ? (wc.reduce((s, x) => s + (x.conf ?? 0), 0) / wc.length).toFixed(2) : 'n/a'}); failed calls that still reported >= 0.9: ${wc.filter((x) => !x.ok && (x.conf ?? 0) >= 0.9).length}`)
    for (const t of trials.filter((x) => !x.passed && x.detail)) console.log(`    [${t.task}] not correct: ${t.detail}   writes that ran: ${t.okWrites.join('; ') || 'none'}`)
    for (const t of trials.filter((x) => x.error).slice(0, 2)) console.log(`    run error (${t.task}): ${t.error}`)
  }
  console.log('\nThese are counts from a few samples, not rates. "correct" is an objective check (the file is imported and called), not a judgement. Paste this whole output back; do not summarise it.')
}
await main()
