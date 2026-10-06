/** Phase 5.3-5.5: the policy table, the approval flow, confidence scoring, and the deny-list. Scripted: no model is involved, only tool calls. */
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { ToolRegistry, type ActionClass, type ToolCallEvent, type ToolDefinition } from '../src/bundles/tool-registry/index.js'
import { LLMService, MockProvider } from '../src/bundles/model-adapter/index.js'
import { AgentLoop } from '../src/bundles/agent-loop/index.js'
import { SubagentScope } from '../src/bundles/subagent-scope/index.js'
import { BUILTIN_DENY_RULES, PolicyError, PolicyGates, confidenceProperty, type ApprovalDecision, type PolicyConfig } from '../src/bundles/policy-gates/index.js'

const ROOT = process.platform === 'win32' ? 'C:\\proj' : '/proj'
const objSchema = { type: 'object' }
const writeSchema = { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, confidence: confidenceProperty } }

async function boot(config: PolicyConfig = {}, o: { scope?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(ToolRegistry)
  if (o.scope) {
    await ctx.plugin(EgressPolicy, { projectId: 't' })
    await ctx.plugin(LLMService, {})
    ctx.llm.register('mock', new MockProvider(() => ({ text: 'ok', stopReason: 'end_turn' as const })), { default: true })
    await ctx.plugin(AgentLoop, {})
    await ctx.plugin(SubagentScope)
  }
  const ran: string[] = []
  const def = (name: string, actionClass: ActionClass, inputSchema: Record<string, unknown> = objSchema): ToolDefinition => ({
    name, description: name, inputSchema, actionClass, execute: () => { ran.push(name); return 'done' },
  })
  ctx.tools.register(def('look', 'read-only'))
  ctx.tools.register(def('scratch', 'sandbox-write'))
  ctx.tools.register(def('edit', 'real-fs-write', writeSchema))
  ctx.tools.register(def('notify', 'external-side-effect', writeSchema))
  ctx.tools.register(def('shell', 'sandbox-write'))
  await ctx.plugin(PolicyGates, { projectRoot: ROOT, ...config })
  const types = async (sid = 's') => (await ctx.log.read(sid)).map((e) => e.type)
  const events = async (type: string, sid = 's') => (await ctx.log.read(sid)).filter((e) => e.type === type)
  const call = (name: string, input: unknown, actor?: string) => ctx.tools.call(name, input, { sessionId: 's', ...(actor ? { actor } : {}) })
  return { ctx, ran, types, events, call }
}
const ev = (actionClass: ActionClass, input: unknown, name = 't'): ToolCallEvent => ({ sessionId: 's', tool: { name, description: name, inputSchema: objSchema, actionClass }, input })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Let a tool call reach its approval hold. */
async function until(f: () => boolean, ms = 2000) {
  const t = Date.now()
  while (!f()) {
    if (Date.now() - t > ms) throw new Error('timed out waiting for condition')
    await wait(5)
  }
}

describe('deny-list rules (5.5)', () => {
  const hits = (s: string | string[]) => BUILTIN_DENY_RULES.filter((r) => r.matches(Array.isArray(s) ? s : [s])).map((r) => r.id)
  const deny = (cases: string[], rule?: string) => {
    for (const c of cases) {
      const h = hits(c)
      expect(h.length, `should deny: ${c}`).toBeGreaterThan(0)
      if (rule) expect(h, c).toContain(rule)
    }
  }
  const allow = (cases: string[]) => {
    for (const c of cases) expect(hits(c), `should allow: ${c}`).toEqual([])
  }
  it('rm with recursive+force, in every spelling and wrapper', () => {
    deny([
      'rm -rf /', 'rm -fr dir', 'rm -r -f dir', 'rm -Rf dir', 'rm --recursive --force x', 'rm -rfv x', 'rm x -rf', 'rm -f -R x',
      'sudo rm -rf x', '/bin/rm -rf x', 'command rm -rf x', 'env rm -rf x', 'xargs rm -rf', 'RM -RF x', 'echo hi && rm -rf build', 'ls; rm -rf .',
      'bash -c "rm -rf /tmp/x"', '$(rm -rf x)', '`rm -rf x`', 'rm${IFS}-rf${IFS}x', 'rm\t-rf x', 'rm\n-rf x',
      "r''m -rf x", 'r"m" -rf x', 'r\\m -rf x', '"rm" -rf x', 'C:\\tools\\rm.exe -rf x', 'git rm -rf dir', // git rm -rf is treated as rm -rf: conservative
    ], 'rm-recursive-force')
  })
  it('does not flag rm without BOTH flags, or things that merely contain "rm"', () => {
    allow(['rm file.txt', 'rm -r dir', 'rm -f file', 'rmdir empty', 'npm run format', 'echo "firmware"', 'git rm file.txt', 'ls -rf', 'perform -rf', 'form -rf x'])
  })
  it('Windows recursive deletes (cmd and PowerShell)', () => {
    deny(['Remove-Item -Recurse -Force C:\\x', 'remove-item -r -fo x', 'ri -Recurse -Force x', 'rd /s /q C:\\x', 'rmdir /S /Q x', 'del /s /q *.*', 'erase /s /f x'], 'windows-recursive-delete')
    allow(['Remove-Item file.txt', 'Remove-Item -Recurse x', 'rd emptydir', 'del file.txt', 'rmdir /s x'])
  })
  it('find -delete, and recursive deletes written as code', () => {
    deny(['find . -name "*.log" -delete'], 'find-delete')
    deny(['find . -type f -exec rm -rf {} +'], 'rm-recursive-force')
    deny(['shutil.rmtree(p)', 'fs.rmSync(p, { recursive: true, force: true })', 'rimraf dist', 'fs.rmdirSync(d, {recursive: true})'], 'code-recursive-delete')
    allow(['find . -name x', 'fs.rmSync(p)', 'import firmware', 'fs.readdirSync(d, { recursive: true })'])
  })
  it('git force-push in every form', () => {
    deny([
      'git push --force', 'git push -f origin main', 'git push origin main --force', 'git push --force-with-lease', 'git push -fu origin x', 'git push origin +main',
      'git push --mirror', 'git -C repo push -f', 'sudo git push -f', "g''it push -f", 'git push --force-with-lease=main:abc', 'echo ok && git push -f',
    ], 'git-force-push')
    allow(['git push origin main', 'git push -u origin main', 'git push --follow-tags', 'git push --set-upstream origin x', 'git pull --force', 'git fetch -f', 'git status'])
  })
  it('credential files, with Windows and POSIX separators', () => {
    deny([
      '~/.aws/credentials', 'C:\\Users\\a\\.aws\\credentials', '.ssh/id_rsa', 'cat id_ed25519', '~/.npmrc', 'config/.env.production', 'certs/server.pem',
      'service-account-prod.json', 'secrets.yaml', '/etc/shadow', '.kube/config', 'kubeconfig', '.docker/config.json', '.netrc', 'credentials.json', 'cat C:\\Users\\a\\.ssh\\config',
    ], 'credential-path')
    allow(['id_rsa.pub', '.env.example', '.env', 'src/credentials-helper.ts', 'README.md', 'docs/secrets-policy.md', 'src/app.ts', 'C:\\proj\\src\\a.ts'])
  })
  it('finds a command split across fields, and strings nested anywhere in the input', () => {
    const rule = BUILTIN_DENY_RULES.find((r) => r.id === 'rm-recursive-force')!
    expect(rule.matches(['rm', '-rf', '/'])).toBeUndefined() // each string alone is harmless...
    // ...which is why the gate also matches the joined strings (checked through evaluate below)
  })
  it('known false positives, pinned so a change is deliberate: text that merely mentions a forbidden command', () => {
    expect(hits('git commit -m "push -f later"')).toContain('git-force-push')
    expect(hits('echo rm -rf')).toContain('rm-recursive-force')
  })
  it('does not catch encoded or indirect commands (documented limit)', () => {
    expect(hits('echo cm0gLXJmIC8= | base64 -d | sh')).toEqual([])
    expect(hits('X=rm; $X -rf /')).toEqual([])
  })
})

describe('evaluate: the policy table', () => {
  it('read-only: allowed, no approval step', async () => {
    const { ctx } = await boot()
    expect(ctx.policy.evaluate(ev('read-only', { path: 'src/a.ts' }))).toMatchObject({ verdict: 'allow', class: 'read-only' })
  })
  it('sandbox-write: allowed and logged', async () => {
    const { ctx } = await boot()
    expect(ctx.policy.evaluate(ev('sandbox-write', { path: 'tmp/x' }))).toMatchObject({ verdict: 'allow-logged', class: 'sandbox-write' })
  })
  it('external-side-effect: ALWAYS held, even at maximal confidence and a perfect-looking input', async () => {
    const { ctx } = await boot()
    for (const confidence of [1, 0.99, 0]) {
      expect(ctx.policy.evaluate(ev('external-side-effect', { path: 'src/a.ts', content: 'x', confidence }))).toMatchObject({ verdict: 'hold' })
    }
  })
  it('deny-list wins over every class, including read-only and external-side-effect', async () => {
    const { ctx } = await boot()
    for (const cls of ['read-only', 'sandbox-write', 'real-fs-write', 'external-side-effect'] as const) {
      expect(ctx.policy.evaluate(ev(cls, { command: 'rm -rf /', confidence: 1 }))).toMatchObject({ verdict: 'deny', rule: 'rm-recursive-force' })
    }
    expect(ctx.policy.evaluate(ev('read-only', { path: '~/.ssh/id_rsa' }))).toMatchObject({ verdict: 'deny', rule: 'credential-path' })
  })
  it('a command split across fields is still denied', async () => {
    const { ctx } = await boot()
    expect(ctx.policy.evaluate(ev('sandbox-write', { command: 'rm', args: ['-rf', '/'] }))).toMatchObject({ verdict: 'deny' })
    expect(ctx.policy.evaluate(ev('sandbox-write', { cmd: 'git', argv: ['push', '--force', 'origin'] }))).toMatchObject({ verdict: 'deny' })
  })
  it('extra deny rules can be added', async () => {
    const { ctx } = await boot({ extraDenyRules: [{ id: 'no-drop', description: 'x', matches: (ss) => (ss.some((s) => /drop table/i.test(s)) ? 'drop table' : undefined) }] })
    expect(ctx.policy.evaluate(ev('sandbox-write', { sql: 'DROP TABLE users' }))).toMatchObject({ verdict: 'deny', rule: 'no-drop' })
    expect(ctx.policy.evaluate(ev('sandbox-write', { command: 'rm -rf /' }))).toMatchObject({ verdict: 'deny', rule: 'rm-recursive-force' }) // built-ins remain
  })
})

describe('evaluate: confidence scoring for real-fs-write (5.4)', () => {
  const w = (input: Record<string, unknown>) => ev('real-fs-write', input)
  it('a high self-reported score is NOT enough when an independent signal is low (it is capped by it)', async () => {
    const { ctx } = await boot()
    const d = ctx.policy.evaluate(w({ path: 'package.json', content: '{}', confidence: 0.99 }))
    expect(d.verdict).toBe('hold')
    expect(d.score).toBe(0.5)
    expect(d.reason).toMatch(/path-criticality.*dependency manifest/)
    // the same self-report on an ordinary file is allowed
    expect(ctx.policy.evaluate(w({ path: 'src/a.ts', content: 'x', confidence: 0.99 }))).toMatchObject({ verdict: 'allow-logged', score: 0.99 })
  })
  it('the combined score is the MINIMUM of the self-report and every signal', async () => {
    const { ctx } = await boot()
    const d = ctx.policy.evaluate(w({ path: 'src/a.ts', content: 'x'.repeat(10_000), confidence: 0.95 }))
    expect(d.signals!.map((s) => s.name)).toEqual(['path-criticality', 'diff-size'])
    expect(d.score).toBe(Math.min(0.95, ...d.signals!.map((s) => s.score)))
  })
  it('a low self-report holds even when the independent signals are perfect, and says so', async () => {
    const { ctx } = await boot()
    const d = ctx.policy.evaluate(w({ path: 'src/a.ts', content: 'x', confidence: 0.4 }))
    expect(d).toMatchObject({ verdict: 'hold', score: 0.4 })
    expect(d.reason).toMatch(/model's own confidence/)
  })
  it('no valid self-report means hold: missing, out of range, a string, NaN', async () => {
    const { ctx } = await boot()
    for (const bad of [undefined, 1.5, -0.1, '0.9', Number.NaN, null]) {
      const d = ctx.policy.evaluate(w({ path: 'src/a.ts', content: 'x', ...(bad === undefined ? {} : { confidence: bad }) }))
      expect(d.verdict, String(bad)).toBe('hold')
      expect(d.self).toBeNull()
      expect(d.reason, String(bad)).toMatch(/no valid self-reported confidence/)
    }
  })
  it('with NO independent signal available, a perfect self-report still holds (never trust self-report alone)', async () => {
    const { ctx } = await boot()
    const d = ctx.policy.evaluate(w({ note: 'no path and no content here', confidence: 1 }))
    expect(d.verdict).toBe('hold')
    expect(d.reason).toMatch(/no independent signal/)
  })
  it('a path outside the project root scores 0: held whatever the model says', async () => {
    const { ctx } = await boot()
    const outside = process.platform === 'win32' ? 'D:\\elsewhere\\x.ts' : '/elsewhere/x.ts'
    for (const p of [outside, '../escape.ts', '../../etc/x']) {
      expect(ctx.policy.evaluate(w({ path: p, content: 'x', confidence: 1 })), p).toMatchObject({ verdict: 'hold', score: 0 })
    }
  })
  it('critical paths are scored low; ordinary ones are not; the lowest of several paths decides', async () => {
    const { ctx } = await boot()
    const score = (path: unknown) => ctx.policy.evaluate(w({ path, content: 'x', confidence: 1 })).score
    expect(score('src/deep/a.ts')).toBe(1)
    expect(score('.git/config')).toBe(0.1)
    expect(score('.github/workflows/ci.yml')).toBe(0.3)
    expect(score('package-lock.json')).toBe(0.4)
    expect(score('Dockerfile')).toBe(0.5)
    expect(score('.env.local')).toBe(0.3)
    expect(score('vite.config.ts')).toBe(0.6)
    expect(score(['src/a.ts', '.git/HEAD'])).toBe(0.1)
  })
  it('diff size: small is fine, huge is risky, and it scales down smoothly', async () => {
    const { ctx } = await boot()
    const score = (n: number) => ctx.policy.evaluate(w({ path: 'src/a.ts', content: 'x'.repeat(n), confidence: 1 })).signals!.find((s) => s.name === 'diff-size')!.score
    expect(score(100)).toBe(1)
    expect(score(2000)).toBe(1)
    expect(score(10_000)).toBeLessThan(1)
    expect(score(10_000)).toBeGreaterThan(score(40_000))
    expect(score(500_000)).toBe(0.2)
  })
  it('a score exactly AT the threshold is allowed; just under it is held', async () => {
    const { ctx } = await boot()
    expect(ctx.policy.evaluate(w({ path: 'src/a.ts', content: 'x', confidence: 0.8 })).verdict).toBe('allow-logged')
    expect(ctx.policy.evaluate(w({ path: 'src/a.ts', content: 'x', confidence: 0.79 })).verdict).toBe('hold')
  })
  it('the threshold is configurable and validated; custom signals can lower the score; a signal returning undefined is ignored', async () => {
    const lenient = await boot({ confidenceThreshold: 0.5 })
    expect(lenient.ctx.policy.evaluate(w({ path: 'src/a.ts', content: 'x', confidence: 0.6 })).verdict).toBe('allow-logged')
    const strict = await boot({ confidenceThreshold: 1 })
    expect(strict.ctx.policy.evaluate(w({ path: 'src/a.ts', content: 'x', confidence: 0.99 })).verdict).toBe('hold')
    const custom = await boot({ signals: [() => ({ name: 'no-tests', score: 0.2, note: 'untested path' }), () => undefined] })
    const d = custom.ctx.policy.evaluate(w({ path: 'src/a.ts', content: 'x', confidence: 1 }))
    expect(d).toMatchObject({ verdict: 'hold', score: 0.2 })
    expect(d.reason).toMatch(/no-tests/)
    const ctx = new Context()
    await ctx.plugin(SessionLog, { memory: true }); await ctx.plugin(ToolRegistry)
    await expect(ctx.plugin(PolicyGates, { confidenceThreshold: 2 })).rejects.toThrow(/between 0 and 1/)
  })
})

describe('the gate through the registry: 5.3 read-only and sandbox-write', () => {
  it('a read-only call runs with no approval step, and its decision is logged', async () => {
    const { call, ran, types, events } = await boot()
    expect(await call('look', { path: 'src/a.ts' })).toMatchObject({ ok: true })
    expect(ran).toEqual(['look'])
    expect(await types()).not.toContain('approval.pending')
    expect((await events('policy.decision'))[0]!.data).toMatchObject({ tool: 'look', verdict: 'allow', class: 'read-only' })
  })
  it('a sandbox-scoped write runs autonomously AND leaves a log entry', async () => {
    const { call, ran, types, events } = await boot()
    expect(await call('scratch', { path: 'tmp/x' })).toMatchObject({ ok: true })
    expect(ran).toEqual(['scratch'])
    expect(await types()).not.toContain('approval.pending')
    expect((await events('policy.decision'))[0]!.data).toMatchObject({ tool: 'scratch', verdict: 'allow-logged', class: 'sandbox-write' })
  })
  it('the decision is logged BEFORE the tool runs', async () => {
    const { call, types } = await boot()
    await call('look', {})
    const t = await types()
    expect(t.indexOf('policy.decision')).toBeGreaterThan(t.indexOf('tool.call'))
    expect(t.indexOf('policy.decision')).toBeLessThan(t.indexOf('tool.result'))
  })
})

describe('the gate through the registry: 5.4 holds and approvals', () => {
  const lowConfidence = { path: 'src/a.ts', content: 'x', confidence: 0.2 }
  it('a high-confidence ordinary write is auto-approved and logged with its score; no approval step', async () => {
    const { call, ran, types, events } = await boot()
    expect(await call('edit', { path: 'src/a.ts', content: 'x', confidence: 0.95 })).toMatchObject({ ok: true })
    expect(ran).toEqual(['edit'])
    expect(await types()).not.toContain('approval.pending')
    expect((await events('policy.decision'))[0]!.data).toMatchObject({ verdict: 'allow-logged', score: 0.95, self: 0.95 })
  })
  it('a held write does NOT run until approved; then it runs, and the whole story is in the log in order', async () => {
    const { ctx, call, ran, types, events } = await boot()
    const p = call('edit', lowConfidence)
    await until(() => ctx.policy.pending().length === 1)
    expect(ran).toEqual([]) // still waiting
    const [req] = ctx.policy.pending()
    expect(req).toMatchObject({ tool: 'edit', class: 'real-fs-write', score: 0.2 })
    ctx.policy.resolve(req!.id, { approve: true, by: 'owner', note: 'looks right' })
    expect(await p).toMatchObject({ ok: true })
    expect(ran).toEqual(['edit'])
    expect(ctx.policy.pending()).toEqual([])
    const t = await types()
    expect(t.filter((x) => x.startsWith('policy.') || x.startsWith('approval.') || x === 'tool.result')).toEqual(['policy.decision', 'approval.pending', 'approval.resolved', 'tool.result'])
    expect((await events('policy.decision'))[0]!.data).toMatchObject({ verdict: 'hold' })
    expect((await events('approval.resolved'))[0]!.data).toMatchObject({ id: req!.id, outcome: 'approved', by: 'owner', note: 'looks right' })
  })
  it('a denied approval blocks the write, tells the model why, and logs the resolution', async () => {
    const { ctx, call, ran, events } = await boot()
    const p = call('edit', lowConfidence)
    await until(() => ctx.policy.pending().length === 1)
    ctx.policy.resolve(ctx.policy.pending()[0]!.id, { approve: false, note: 'no' })
    const r = await p
    expect(r).toMatchObject({ ok: false, errorKind: 'denied' })
    expect(r.content).toMatch(/approval denied: no/)
    expect(ran).toEqual([])
    expect((await events('approval.resolved'))[0]!.data).toMatchObject({ outcome: 'denied' })
  })
  it('an approver callback can answer immediately', async () => {
    const seen: string[] = []
    const { call, ran } = await boot({ approver: (req) => { seen.push(req.tool); return { approve: true, by: 'auto-test' } } })
    expect(await call('edit', lowConfidence)).toMatchObject({ ok: true })
    expect(seen).toEqual(['edit'])
    expect(ran).toEqual(['edit'])
  })
  it('an approver that throws, or returns nonsense, is a DENIAL, never an allow', async () => {
    const throws = await boot({ approver: () => { throw new Error('ui crashed') } })
    const r1 = await throws.call('edit', lowConfidence)
    expect(r1).toMatchObject({ ok: false, errorKind: 'denied' })
    expect(r1.content).toMatch(/approver failed: ui crashed/)
    const junk = await boot({ approver: (() => 'yes please') as any })
    expect(await junk.call('edit', lowConfidence)).toMatchObject({ ok: false, errorKind: 'denied' })
    const undef = await boot({ approver: (() => undefined) as any })
    expect(await undef.call('edit', lowConfidence)).toMatchObject({ ok: false, errorKind: 'denied' })
    expect(throws.ran.concat(junk.ran, undef.ran)).toEqual([])
  })
  it('an unanswered hold times out as a denial, and a late answer is refused', async () => {
    const { ctx, call, ran, events } = await boot({ approvalTimeoutMs: 40 })
    const p = call('edit', lowConfidence)
    await until(() => ctx.policy.pending().length === 1)
    const id = ctx.policy.pending()[0]!.id
    const r = await p
    expect(r).toMatchObject({ ok: false, errorKind: 'denied' })
    expect(r.content).toMatch(/timed out/)
    expect(ran).toEqual([])
    expect((await events('approval.resolved'))[0]!.data).toMatchObject({ outcome: 'timeout' })
    expect(() => ctx.policy.resolve(id, { approve: true })).toThrow(PolicyError)
  })
  it('resolve() refuses an unknown id and a second answer', async () => {
    const { ctx, call } = await boot()
    expect(() => ctx.policy.resolve('nope', { approve: true })).toThrow(/no pending approval/)
    const p = call('edit', lowConfidence)
    await until(() => ctx.policy.pending().length === 1)
    const id = ctx.policy.pending()[0]!.id
    ctx.policy.resolve(id, { approve: false })
    expect(() => ctx.policy.resolve(id, { approve: true })).toThrow(PolicyError)
    await p
  })
  it('two holds at once are independent', async () => {
    const { ctx, call, ran } = await boot()
    const a = call('edit', { ...lowConfidence, path: 'src/a.ts' })
    const b = call('edit', { ...lowConfidence, path: 'src/b.ts' })
    await until(() => ctx.policy.pending().length === 2)
    const [ra, rb] = ctx.policy.pending()
    const byPath = (p: string) => ctx.policy.pending().find((r) => (r.input as any).path === p)!
    ctx.policy.resolve(byPath('src/b.ts').id, { approve: true })
    expect(await b).toMatchObject({ ok: true })
    expect(ran).toEqual(['edit'])
    expect(ctx.policy.pending()).toHaveLength(1)
    ctx.policy.resolve(byPath('src/a.ts').id, { approve: false })
    expect(await a).toMatchObject({ ok: false })
    expect([ra, rb].every(Boolean)).toBe(true)
  })
  it('a held write on a critical file stays held even with a perfect self-report (the 5.4 "not self-report alone" test, end to end)', async () => {
    const { ctx, call, ran } = await boot({ approver: () => ({ approve: false, note: 'critical file' }) })
    const r = await call('edit', { path: 'package.json', content: '{}', confidence: 1 })
    expect(r).toMatchObject({ ok: false, errorKind: 'denied' })
    expect(ran).toEqual([])
    expect(ctx.policy.pending()).toEqual([])
  })
})

describe('the gate through the registry: 5.5 external side effects and the deny-list', () => {
  it('an external side effect ALWAYS holds, even at confidence 1; it runs only after approval', async () => {
    const { ctx, call, ran, types } = await boot()
    const p = call('notify', { path: 'src/a.ts', content: 'x', confidence: 1 })
    await until(() => ctx.policy.pending().length === 1)
    expect(ran).toEqual([])
    expect(ctx.policy.pending()[0]).toMatchObject({ class: 'external-side-effect' })
    ctx.policy.resolve(ctx.policy.pending()[0]!.id, { approve: true })
    expect(await p).toMatchObject({ ok: true })
    expect(await types()).toContain('approval.resolved')
  })
  it('a deny-listed call is blocked, and an approver that approves everything is never even asked', async () => {
    let asked = 0
    const { call, ran, types, events } = await boot({ approver: () => { asked++; return { approve: true } } })
    for (const [tool, input] of [['shell', { command: 'rm -rf /' }], ['look', { path: '~/.ssh/id_rsa' }], ['notify', { content: 'git push --force origin main', confidence: 1 }], ['edit', { path: 'src/a.ts', content: 'x', confidence: 1, cmd: 'rm', args: ['-rf', '.'] }]] as const) {
      const r = await call(tool, input)
      expect(r, tool).toMatchObject({ ok: false, errorKind: 'denied' })
      expect(r.content).toMatch(/deny-listed/)
    }
    expect(asked).toBe(0)
    expect(ran).toEqual([])
    expect(await types()).not.toContain('approval.pending')
    expect((await events('policy.decision')).map((e) => (e.data as any).verdict)).toEqual(['deny', 'deny', 'deny', 'deny'])
    expect((await events('policy.decision')).map((e) => (e.data as any).rule)).toEqual(['rm-recursive-force', 'credential-path', 'git-force-push', 'rm-recursive-force'])
  })
  it('wrapped and aliased forms are blocked through the registry too', async () => {
    const { call, ran } = await boot()
    for (const command of ["sudo /bin/rm -rf /", "r''m -rf x", 'bash -c "git push -f"', 'Remove-Item -Recurse -Force C:\\x', 'find . -delete']) {
      expect(await call('shell', { command }), command).toMatchObject({ ok: false, errorKind: 'denied' })
    }
    expect(ran).toEqual([])
  })
})

describe('failure modes and ordering', () => {
  it('if the decision cannot be logged, the call is denied and does not run (fail closed)', async () => {
    const { ctx, call, ran } = await boot()
    const real = ctx.log.append.bind(ctx.log)
    ;(ctx.log as any).append = async (sid: string, type: string, data: any, actor?: string) => {
      if (type === 'policy.decision') throw new Error('disk full')
      return real(sid, type, data, actor)
    }
    const r = await call('look', {})
    expect(r).toMatchObject({ ok: false, errorKind: 'denied' })
    expect(r.content).toMatch(/disk full/)
    expect(ran).toEqual([])
  })
  it('if the hold cannot be logged, the call is denied and no orphan pending approval is left', async () => {
    const { ctx, call, ran } = await boot()
    const real = ctx.log.append.bind(ctx.log)
    ;(ctx.log as any).append = async (sid: string, type: string, data: any, actor?: string) => {
      if (type === 'approval.pending') throw new Error('disk full')
      return real(sid, type, data, actor)
    }
    const r = await call('edit', { path: 'src/a.ts', content: 'x', confidence: 0.1 })
    expect(r).toMatchObject({ ok: false, errorKind: 'denied' })
    expect(ran).toEqual([])
    expect(ctx.policy.pending()).toEqual([])
  })
  it('a call the sub-agent scope refuses is refused BEFORE anyone is asked to approve it', async () => {
    let asked = 0
    const { ctx, ran, types } = await boot({ approver: () => { asked++; return { approve: true } } }, { scope: true })
    // scope was loaded before the gate, so its hook runs first
    const reader = await ctx.subagents.spawn({ id: 'reader', sessionId: 's', tools: ['look'] })
    const r = await ctx.tools.call('edit', { path: 'src/a.ts', content: 'x', confidence: 0.1 }, { sessionId: 's', actor: reader.actor })
    expect(r).toMatchObject({ ok: false, errorKind: 'denied' })
    expect(r.content).toMatch(/outside the grant/)
    expect(asked).toBe(0)
    expect(ran).toEqual([])
    expect(await types()).not.toContain('approval.pending')
  })
  it('both layers apply: a granted real-fs-write tool is still held by the gate', async () => {
    const { ctx, ran } = await boot({}, { scope: true })
    const editor = await ctx.subagents.spawn({ id: 'editor', sessionId: 's', tools: ['edit'] })
    const p = ctx.tools.call('edit', { path: 'src/a.ts', content: 'x', confidence: 0.3 }, { sessionId: 's', actor: editor.actor })
    await until(() => ctx.policy.pending().length === 1)
    expect(ran).toEqual([]) // granted by scope, still waiting on the gate
    expect(ctx.policy.pending()[0]).toMatchObject({ actor: 'subagent:editor' })
    ctx.policy.resolve(ctx.policy.pending()[0]!.id, { approve: true })
    expect(await p).toMatchObject({ ok: true })
  })
})
