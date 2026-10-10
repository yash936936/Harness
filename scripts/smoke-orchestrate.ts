/**
 * Open item 6 (which model plans) and part of item 7 (answer correctness, real failures under the D-074 policy).
 * Runs the ORCHESTRATOR path (plan, then execute scoped sub-agents) through `profile-coding` on a throwaway project with
 * REAL tools, and grades each task by an objective check on the files / the answer. Not a judgement of plan quality.
 *
 *   HARNESS_CONFIGS="q3=qwen2.5-coder:3b-instruct/qwen2.5-coder:3b-instruct,q7=qwen2.5-coder:7b-instruct/qwen2.5-coder:7b-instruct,split=qwen2.5-coder:7b-instruct/qwen2.5-coder:3b-instruct,single7=single:qwen2.5-coder:7b-instruct" \
 *   HARNESS_TRIALS=3 npx tsx scripts/smoke-orchestrate.ts
 *
 * Config syntax: name=planner/worker (orchestrated), or name=single:model (no orchestrator, one agent: the baseline that says
 * whether orchestration helps at all). HARNESS_ON_FAILURE=continue and HARNESS_RETRIES=1 exercise the D-074 paths.
 * HARNESS_STANDIN=1 self-tests this script; HARNESS_STANDIN=noop must score 0 on every task (proves the checks can fail).
 * Holds are AUTO-APPROVED (safe only because every trial runs in a temp directory). A few trials are counts, not rates.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootProfileCoding } from '../src/profiles/profile-coding.js'
import { MockProvider, OllamaProvider, type LLMProvider } from '../src/bundles/model-adapter/index.js'
import { PlanError } from '../src/bundles/orchestrator/index.js'

const STAND_IN = process.env['HARNESS_STANDIN'] === '1' || process.env['HARNESS_STANDIN'] === 'noop'
const NOOP = process.env['HARNESS_STANDIN'] === 'noop'
const TRIALS = Math.max(1, Number(process.env['HARNESS_TRIALS'] ?? 3) || 3)
const ON_FAILURE = process.env['HARNESS_ON_FAILURE'] === 'continue' ? 'continue' : 'abort'
const RETRIES = Math.max(0, Math.min(3, Number(process.env['HARNESS_RETRIES'] ?? 0) || 0))
const TOOLS = ['read_file', 'edit_file', 'write_file']
const DEFAULT = 'q3=qwen2.5-coder:3b-instruct/qwen2.5-coder:3b-instruct,q7=qwen2.5-coder:7b-instruct/qwen2.5-coder:7b-instruct,split=qwen2.5-coder:7b-instruct/qwen2.5-coder:3b-instruct,single7=single:qwen2.5-coder:7b-instruct'
interface Cfg { name: string; planner?: string; worker: string; single: boolean }
const CONFIGS: Cfg[] = STAND_IN
  ? [{ name: 'stand-in', planner: 'stand-in', worker: 'stand-in', single: false }, { name: 'stand-in-single', worker: 'stand-in', single: true }]
  : (process.env['HARNESS_CONFIGS'] ?? DEFAULT).split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [name, rest = ''] = s.split('=')
      if (rest.startsWith('single:')) return { name: name!, worker: rest.slice(7), single: true }
      const [planner, worker] = rest.split('/')
      return { name: name!, planner: planner!, worker: worker ?? planner!, single: false }
    })

const MATH = 'export const LIMIT = 4172\n\nexport function add(a, b) {\n  return a - b\n}\n'
const UTIL = 'export function scale(x) {\n  return x * 7 + 1\n}\n'
const LAYOUT = 'The project has these files: package.json, src/math.js, src/util.js. Paths are relative to the project root.'
interface Task { id: string; prompt: string; check(root: string, text: string): boolean }
const TASKS: Task[] = [
  { id: 'fix', prompt: `${LAYOUT} The function add in src/math.js has a bug: it should return the sum of a and b. Read the file, then fix it by editing it.`, check: (r) => /return a \+ b/.test(readFileSync(join(r, 'src/math.js'), 'utf8')) && /LIMIT = 4172/.test(readFileSync(join(r, 'src/math.js'), 'utf8')) },
  { id: 'copy', prompt: `${LAYOUT} Read src/math.js, then create the file src/limit.txt containing only the value of the constant LIMIT.`, check: (r) => existsSync(join(r, 'src/limit.txt')) && readFileSync(join(r, 'src/limit.txt'), 'utf8').trim() === '4172' },
  { id: 'answer', prompt: `${LAYOUT} Read src/util.js and tell me what scale(3) returns. Answer with just the number.`, check: (_r, t) => /\b22\b/.test(t) && !/\b21\b/.test(t) },
]

function standIn(): LLMProvider {
  if (NOOP) return new MockProvider((() => ({ text: 'nothing to do', stopReason: 'end_turn' })) as any)
  const turns = (m: any[]) => m.filter((x) => x.role === 'assistant').length
  const call = (m: any[], name: string, input: unknown) => ({ toolCalls: [{ id: `c${turns(m)}`, name, input }], content: [{ type: 'tool_use', id: `c${turns(m)}`, name, input }] }) as any
  return new MockProvider(((req: any) => {
    const sys = String(req.system ?? '')
    const m = req.messages
    const prompt = JSON.stringify(m[0]?.content ?? '')
    const t = turns(m)
    if (sys.includes('You are a planner')) {
      const task = prompt
      const goal = task.includes('has a bug') ? 'fix add in src/math.js has a bug' : task.includes('limit.txt') ? 'create src/limit.txt from LIMIT' : 'read src/util.js scale(3)'
      return { text: JSON.stringify({ subtasks: [{ id: 's1', goal, tools: TOOLS, dependsOn: [] }] }) }
    }
    if (prompt.includes('has a bug')) return t === 0 ? call(m, 'edit_file', { path: 'src/math.js', old_string: 'return a - b', new_string: 'return a + b', confidence: 0.9 }) : { text: 'fixed', stopReason: 'end_turn' }
    if (prompt.includes('limit.txt')) return t === 0 ? call(m, 'write_file', { path: 'src/limit.txt', content: '4172', confidence: 0.9 }) : { text: 'done', stopReason: 'end_turn' }
    return t === 0 ? call(m, 'read_file', { path: 'src/util.js' }) : { text: '22', stopReason: 'end_turn' }
  }) as any)
}

async function trial(cfg: Cfg, task: Task, n: number, prov: (name: string) => LLMProvider) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'harness-smoke-orch-')))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'package.json'), '{"name":"fixture","type":"module"}\n')
  writeFileSync(join(root, 'src/math.js'), MATH)
  writeFileSync(join(root, 'src/util.js'), UTIL)
  const start = Date.now()
  const sid = `o${n}`
  const out = { planned: cfg.single, attempts: 0, status: 'n/a', statuses: {} as Record<string, number>, reasons: [] as string[], text: '', error: '' }
  try {
    const ctx = await bootProfileCoding({ projectId: 'smoke-orch', projectRoot: root, sessionLog: { memory: true }, agentLoop: { maxSteps: 10 }, policy: { approvalTimeoutMs: 5000, approver: () => ({ approve: true, by: 'smoke-auto' }) } })
    ctx.llm.register('worker', prov(cfg.worker), { default: true })
    if (cfg.planner) ctx.llm.register('planner', prov(cfg.planner))
    try {
      if (cfg.single) {
        const r = await ctx.memory.runTurn({ sessionId: sid, prompt: task.prompt, tools: TOOLS })
        out.text = r.finalText
        out.status = r.stopReason
      } else {
        const p = await ctx.orchestrator.plan({ sessionId: sid, task: task.prompt, tools: TOOLS, provider: 'planner' })
        out.planned = true
        out.attempts = p.attempts
        const r = await ctx.orchestrator.execute(p.plan, { sessionId: sid, allowedTools: TOOLS, onFailure: ON_FAILURE, retries: RETRIES, maxSteps: 8, provider: 'worker' })
        out.status = r.status
        out.text = Object.values(r.outputs).join(' ')
        for (const s of r.subtasks) {
          out.statuses[s.status] = (out.statuses[s.status] ?? 0) + 1
          if (s.reason) out.reasons.push(s.reason.replace(/\s+/g, ' ').slice(0, 120))
        }
      }
    } catch (e: any) {
      out.error = e instanceof PlanError ? 'plan rejected: ' + e.errors.join('; ').slice(0, 140) : String(e?.message ?? e).slice(0, 140)
    }
    let ok = false
    try { ok = task.check(root, out.text) } catch { ok = false }
    return { ...out, ok, ms: Date.now() - start }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function main() {
  console.log(STAND_IN ? '(STAND-IN: self-test of this script, NOT a measurement of any model)' : `configs: ${CONFIGS.map((c) => c.name).join(', ')}  trials=${TRIALS} x ${TASKS.length} tasks  onFailure=${ON_FAILURE} retries=${RETRIES}`)
  const cache = new Map<string, LLMProvider>()
  const prov = (name: string): LLMProvider => {
    if (STAND_IN) return standIn()
    if (!cache.has(name)) cache.set(name, new OllamaProvider({ model: name, timeoutMs: 600_000, textToolCalls: /qwen/i.test(name) }))
    return cache.get(name)!
  }
  if (!STAND_IN) {
    try {
      const installed = await (prov(CONFIGS[0]!.worker) as OllamaProvider).listModels()
      for (const c of CONFIGS) for (const m of [c.planner, c.worker]) if (m && !installed.some((n) => n === m || n === `${m}:latest`)) throw new Error(`model "${m}" is not installed. Installed: ${installed.join(', ') || '(none)'}`)
    } catch (e: any) { console.error(e?.message ?? e); process.exit(1) }
  }
  let n = 0
  for (const cfg of CONFIGS) {
    const rs: Awaited<ReturnType<typeof trial>>[] = []
    const byTask: Record<string, typeof rs> = {}
    for (let i = 0; i < TRIALS; i++) for (const task of TASKS) {
      process.stdout.write('.')
      const r = await trial(cfg, task, n++, prov)
      rs.push(r);(byTask[task.id] ??= []).push(r)
    }
    const k = (a: number, b: number) => `${a}/${b}`
    console.log(`\n\n=== ${cfg.name}: ${cfg.single ? 'single agent, ' + cfg.worker : `planner ${cfg.planner} / worker ${cfg.worker}`} ===`)
    for (const t of TASKS) {
      const x = byTask[t.id]!
      console.log(`  ${t.id.padEnd(7)} correct ${k(x.filter((r) => r.ok).length, x.length)}   plan valid ${cfg.single ? 'n/a' : k(x.filter((r) => r.planned).length, x.length)}   run completed ${k(x.filter((r) => r.status === 'completed' || r.status === 'done').length, x.length)}   avg ${(x.reduce((s, r) => s + r.ms, 0) / x.length / 1000).toFixed(1)}s`)
    }
    const st: Record<string, number> = {}
    for (const r of rs) for (const [s, c] of Object.entries(r.statuses)) st[s] = (st[s] ?? 0) + c
    if (!cfg.single) console.log(`  subtask statuses: ${JSON.stringify(st)}   repaired plans: ${rs.filter((r) => r.attempts > 1).length}`)
    const why = new Map<string, number>()
    for (const r of rs) for (const s of [...r.reasons, r.error].filter(Boolean)) why.set(s, (why.get(s) ?? 0) + 1)
    for (const [s, c] of [...why].sort((a, b) => b[1] - a[1]).slice(0, 4)) console.log(`    x${c} ${s}`)
    console.log(`  TOTAL correct ${k(rs.filter((r) => r.ok).length, rs.length)}`)
  }
  console.log('\nCounts from a few samples, not rates. "correct" is an objective file/answer check, not a judgement of plan quality. Paste this whole output back; do not summarise it.')
}
await main()
