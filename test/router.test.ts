import { Context } from 'cordis'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CommandBackend, RulesBackend, Router, SUITE, SUITE_SHA256, evaluateClass, suiteSha256, verdict, type Candidate, type ClassResult, type DecisionClass, type RouterBackend } from '../src/bundles/router/index.js'
import { bootProfileCoding } from '../src/profiles/profile-coding.js'
import { NEEDLE_PIN, ROUTER_BINDING } from '../src/bundles/model-store/index.js'

const FAKE = join(__dirname, 'fixtures', 'fake-needle.mjs')
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'harness-router-'))); dirs.push(d); return d }

const CANDS: Candidate[] = [
  { id: 'a', description: 'alpha apples', allowed: true },
  { id: 'b', description: 'bravo bananas', allowed: true },
  { id: 'c', description: 'charlie cherries', allowed: false },
]
const fixed = (name: 'needle' | 'worker' | 'rules', answer: string | null | (() => never), cost = 0): RouterBackend & { calls: number } => {
  const b: any = { name, requestCost: cost, calls: 0, async decide() { b.calls++; if (typeof answer === 'function') answer(); return answer } }
  return b
}
async function mk(cfg: ConstructorParameters<typeof Router>[1] = {}) {
  const ctx = new Context()
  await ctx.plugin(Router, cfg)
  return ctx
}

describe('frozen suite', () => {
  it('is frozen: contents match the pinned hash, 15 cases per class', () => {
    expect(suiteSha256()).toBe(SUITE_SHA256)
    for (const c of ['agent', 'playbook', 'tool'] as DecisionClass[]) {
      expect(SUITE[c].cases).toHaveLength(15)
      const ids = new Set(SUITE[c].candidates.map((x) => x.id))
      for (const k of SUITE[c].cases) expect(ids.has(k.expect)).toBe(true) // every label is a real candidate
    }
  })
})

describe('rules backend (fallback 2)', () => {
  const r = new RulesBackend()
  it('picks a clear winner and abstains on ties and on no overlap', async () => {
    expect(await r.decide('agent', { task: 'apples please', candidates: CANDS })).toBe('a')
    expect(await r.decide('agent', { task: 'apples bananas', candidates: CANDS })).toBeNull()
    expect(await r.decide('agent', { task: 'zzz qqq', candidates: CANDS })).toBeNull()
  })
  it('is wrong on at most one case per class on the frozen suite and never errors', async () => {
    for (const c of ['agent', 'playbook', 'tool'] as DecisionClass[]) {
      const res = await evaluateClass(r, c)
      expect(res.errors).toBe(0)
      expect(res.cases - res.correct - res.abstained).toBeLessThanOrEqual(1)
    }
  })
})

describe('router chain', () => {
  it('default: owns nothing, Needle is never asked, the worker decides', async () => {
    const needle = fixed('needle', 'a'); const worker = fixed('worker', 'b', 1)
    const ctx = await mk({ needle, worker })
    const d = await ctx.router.decide('agent', { task: 'x', candidates: CANDS })
    expect(d).toMatchObject({ choice: 'b', source: 'worker', workerRequests: 1, requestSaved: false })
    expect(needle.calls).toBe(0)
  })
  it('an owned class goes to Needle first and records a saved request', async () => {
    const needle = fixed('needle', 'a'); const worker = fixed('worker', 'b', 1)
    const ctx = await mk({ needle, worker, owned: ['agent'] })
    const d = await ctx.router.decide('agent', { task: 'x', candidates: CANDS })
    expect(d).toMatchObject({ choice: 'a', source: 'needle', workerRequests: 0, requestSaved: true })
    expect(worker.calls).toBe(0)
    expect((await ctx.router.decide('playbook', { task: 'x', candidates: CANDS })).source).toBe('worker') // not owned
    const s = ctx.router.stats()
    expect(s.requestsSaved).toBe(1); expect(s.workerRequests).toBe(1); expect(s.byClass.agent.bySource.needle).toBe(1)
  })
  it('falls through needle -> rules -> worker on throw, hang, abstain, and an invented id', async () => {
    const worker = fixed('worker', 'b', 1)
    for (const bad of [fixed('needle', () => { throw new Error('boom') }), fixed('needle', null), fixed('needle', 'rm_everything')]) {
      const ctx = await mk({ needle: bad, worker, owned: ['agent'] })
      const d = await ctx.router.decide('agent', { task: 'zzz', candidates: CANDS }) // rules abstain on this task
      expect(d.source).toBe('worker'); expect(d.choice).toBe('b')
      expect(d.skipped.map((s) => s.source)).toEqual(['needle', 'rules'])
    }
    const hang: RouterBackend = { name: 'needle', decide: () => new Promise(() => {}) }
    const ctx = await mk({ needle: hang, worker, owned: ['agent'], backendTimeoutMs: 40 })
    const d = await ctx.router.decide('agent', { task: 'zzz', candidates: CANDS })
    expect(d.source).toBe('worker'); expect(d.skipped[0]?.why).toMatch(/timed out/)
  })
  it('rules answer before the worker for an owned class when Needle is absent', async () => {
    const worker = fixed('worker', 'b', 1)
    const ctx = await mk({ worker, owned: ['agent'] })
    const d = await ctx.router.decide('agent', { task: 'apples', candidates: CANDS })
    expect(d).toMatchObject({ source: 'rules', choice: 'a', requestSaved: true }); expect(worker.calls).toBe(0)
  })
  it('the tool class only offers allowed candidates, at most five, and never the rest', async () => {
    let offered: string[] = []
    const spy: RouterBackend = { name: 'worker', async decide(_c, r) { offered = r.candidates.map((c) => c.id); return r.candidates[0]!.id } }
    const ctx = await mk({ worker: spy, maxToolCandidates: 1 })
    await ctx.router.decide('tool', { task: 'x', candidates: CANDS })
    expect(offered).toEqual(['a'])
    const lying = fixed('worker', 'c') // answers a tool that was never offered
    const ctx2 = await mk({ worker: lying })
    const d = await ctx2.router.decide('tool', { task: 'zzz', candidates: CANDS })
    expect(d.choice).toBeNull(); expect(d.source).toBe('none')
  })
  it('no eligible candidate: no backend is called', async () => {
    const worker = fixed('worker', 'a', 1)
    const ctx = await mk({ worker })
    const d = await ctx.router.decide('tool', { task: 'x', candidates: [{ id: 'c', description: 'x', allowed: false }] })
    expect(d).toMatchObject({ choice: null, source: 'none' }); expect(worker.calls).toBe(0)
  })
  it('reports every decision with a session to onDecision, and a throwing hook never breaks routing', async () => {
    const seen: any[] = []
    const ctx = await mk({ worker: fixed('worker', 'a', 1), onDecision: (sid, d) => { seen.push([sid, d.source, d.choice]) } })
    await ctx.router.decide('agent', { task: 'x', candidates: CANDS, sessionId: 's1' })
    await ctx.router.decide('agent', { task: 'x', candidates: CANDS }) // no session: not reported
    expect(seen).toEqual([['s1', 'worker', 'a']])
    const bad = await mk({ worker: fixed('worker', 'a', 1), onDecision: () => { throw new Error('x') } })
    expect((await bad.router.decide('agent', { task: 'x', candidates: CANDS, sessionId: 's' })).choice).toBe('a')
  })
})

describe('command backend (Needle stand-in)', () => {
  const cmd = (mode: string, extra: Record<string, unknown> = {}) => new CommandBackend({ command: process.execPath, args: [FAKE, mode], timeoutMs: 3000, ...extra })
  it('round-trips one JSON line and returns the candidate id', async () => {
    expect(await cmd('last').decide('agent', { task: 'x', candidates: CANDS })).toBe('c')
    expect(await cmd('abstain').decide('agent', { task: 'x', candidates: CANDS })).toBeNull()
  })
  it('invalid output rejects; a hang is killed at the timeout', async () => {
    await expect(cmd('invalid').decide('agent', { task: 'x', candidates: CANDS })).rejects.toThrow(/invalid JSON/)
    await expect(new CommandBackend({ command: process.execPath, args: [FAKE, 'hang'], timeoutMs: 150 }).decide('agent', { task: 'x', candidates: CANDS })).rejects.toThrow(/timed out/)
  })
  it('missing files = unavailable, silently skipped by the router', async () => {
    const needle = cmd('last', { requiredFiles: [join(tmp(), 'needle2.cact')] })
    expect((await needle.available()).ok).toBe(false)
    const ctx = await mk({ needle, worker: fixed('worker', 'b', 1), owned: ['agent'] })
    const d = await ctx.router.decide('agent', { task: 'apples', candidates: CANDS })
    expect(d.source).toBe('rules'); expect(d.skipped[0]).toMatchObject({ source: 'needle' }); expect(d.skipped[0]?.why).toMatch(/not installed/)
  })
  it('weights that do not match the pinned sha256 disable the backend; matching ones enable it', async () => {
    const f = join(tmp(), 'w.cact'); writeFileSync(f, 'weights')
    expect((await cmd('last', { requiredFiles: [f], expectedSha256: '0'.repeat(64) }).available())).toMatchObject({ ok: false, why: expect.stringMatching(/pinned sha256/) })
    expect((await cmd('last', { requiredFiles: [f], expectedSha256: createHash('sha256').update('weights').digest('hex') }).available()).ok).toBe(true)
  })
  it('never receives candidates beyond what the router offered', async () => {
    const seen: string[][] = []
    const spy: RouterBackend = { name: 'needle', async decide(_c, r) { seen.push(r.candidates.map((c) => c.id)); return 'a' } }
    const ctx = await mk({ needle: spy, owned: ['tool'] })
    await ctx.router.decide('tool', { task: 'x', candidates: CANDS })
    expect(seen[0]).toEqual(['a', 'b'])
  })
})

describe('ownership verdict (4.5 success criterion 2)', () => {
  const r = (o: Partial<ClassResult> = {}): ClassResult => ({ class: 'agent', backend: 'x', cases: 15, correct: 12, abstained: 0, errors: 0, avgLatencyMs: 5, requests: 0, ...o })
  it('owns only when accuracy >= worker AND faster AND fewer requests', () => {
    const w = r({ backend: 'worker', correct: 12, avgLatencyMs: 900, requests: 15 })
    expect(verdict(r(), w).owns).toBe(true)
    expect(verdict(r({ correct: 11 }), w)).toMatchObject({ owns: false, reason: expect.stringMatching(/less accurate/) })
    expect(verdict(r({ avgLatencyMs: 900 }), w)).toMatchObject({ owns: false, reason: expect.stringMatching(/not faster/) })
    expect(verdict(r({ requests: 15 }), w)).toMatchObject({ owns: false, reason: expect.stringMatching(/save requests/) })
    expect(verdict(r({ cases: 10 }), w)).toMatchObject({ owns: false, reason: expect.stringMatching(/cases/) })
  })
})

describe('startup and wiring (4.5 criterion 3 and 1)', () => {
  it('Needle files deleted: profile-coding boots normally and routing still works through rules', async () => {
    const root = tmp(); mkdirSync(join(root, 'src'))
    const ctx = await bootProfileCoding({
      projectId: 'p', projectRoot: root, sessionLog: { memory: true },
      router: { needle: { command: process.execPath, args: [FAKE, 'last'], requiredFiles: [join(root, 'models', 'needle2.cact')] }, owned: ['agent', 'playbook', 'tool'] },
    })
    const d = await ctx.router.decide('agent', { task: 'Find where the retry backoff is configured, search the docs', candidates: SUITE.agent.candidates })
    expect(d.skipped[0]).toMatchObject({ source: 'needle' })
    expect(['rules', 'worker', 'none']).toContain(d.source) // no real worker model here: the chain ends gracefully, never throws
  })
  it('no router config: ctx.router exists, owns nothing', async () => {
    const root = tmp(); mkdirSync(join(root, 'src'))
    const ctx = await bootProfileCoding({ projectId: 'p', projectRoot: root, sessionLog: { memory: true } })
    expect(ctx.router.owns('agent')).toBe(false)
  })
  it('the router binding is pinned to the registered Needle record', () => {
    expect(ROUTER_BINDING).toEqual({ name: 'router', pinnedModelId: NEEDLE_PIN.id, fallbackIds: [] })
  })
})
