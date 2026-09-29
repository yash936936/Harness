import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runTask } from '../src/cli/run.js'
import type { CredentialStore } from '../src/bundles/app-core/credentials.js'
import { MemoryConsentStore } from '../src/bundles/egress/index.js'

class MemoryCredentialStore implements CredentialStore {
  data = new Map<string, string>()
  async get(k: string) { return this.data.get(k) }
  async set(k: string, v: string) { this.data.set(k, v) }
  async delete(k: string) { this.data.delete(k) }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const ollamaOk = () => json(200, { model: 'm', message: { role: 'assistant', content: 'hello back' }, done_reason: 'stop', prompt_eval_count: 4, eval_count: 3 })
const openaiOk = () => json(200, { model: 'm', choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1 } })

function counting(respond: () => Response | Promise<Response>) {
  const state = { calls: 0 }
  const f = (async () => { state.calls++; return respond() }) as unknown as typeof fetch
  return { f, state }
}
function sink() {
  const lines: string[] = []
  return { lines, print: (l: string) => void lines.push(l) }
}

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'run-test-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const base = { prompt: 'hello', projectId: 'p1', kind: 'ollama' as const, model: 'm' }

describe('runTask - budget-stop (1B.2)', () => {
  it('the second run in a day is refused at the hard limit, across a restart, and never reaches the provider', async () => {
    const { f, state } = counting(ollamaOk)
    const first = await runTask(sink(), { ...base, dailyLimit: 1 }, { fetch: f, stateDir: dir, credentialStore: new MemoryCredentialStore(), consentStore: new MemoryConsentStore() })
    expect(first).toMatchObject({ ok: true, text: 'hello back', requestsLeftToday: 0 })
    expect(state.calls).toBe(1)

    // A fresh call = a fresh process: everything rebuilt, only <stateDir>/budget.json carries over.
    const out = sink()
    const second = await runTask(out, { ...base, dailyLimit: 1 }, { fetch: f, stateDir: dir, credentialStore: new MemoryCredentialStore(), consentStore: new MemoryConsentStore() })
    expect(second).toMatchObject({ ok: false, reason: 'budget' })
    expect(state.calls).toBe(1) // provider was NOT called again
    expect(out.lines.some((l) => l.includes('provider was not called'))).toBe(true)

    // D-044: the block is itself an audit event, on its own real session - not silently dropped.
    const files = await readdir(join(dir, 'sessions'))
    expect(files.length).toBe(2) // one session per attempt, including the blocked one
    const events = (await Promise.all(files.map((f2) => readFile(join(dir, 'sessions', f2), 'utf8')))).map((t) => t.trim().split('\n').map((l) => JSON.parse(l)))
    const blockedEvents = events.flat().filter((e) => e.type === 'budget.blocked')
    expect(blockedEvents).toHaveLength(1)
    expect(blockedEvents[0]).toMatchObject({ sessionId: (second as { sessionId: string }).sessionId, data: { metric: 'requests', scope: 'day' } })
    expect(events.flat().some((e) => e.type === 'model.request')).toBe(true) // and it's not that nothing ever logged a request
  })

  it('with no limit configured there is no stop', async () => {
    const { f } = counting(ollamaOk)
    for (let i = 0; i < 3; i++) {
      const r = await runTask(sink(), base, { fetch: f, stateDir: dir, credentialStore: new MemoryCredentialStore(), consentStore: new MemoryConsentStore() })
      expect(r.ok).toBe(true)
    }
  })
})

describe('runTask - offline (1B.2)', () => {
  const refused = () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) }

  it('local provider, network unreachable: boots, says it works offline, fails cleanly instead of crashing', async () => {
    const { f } = counting(refused)
    const out = sink()
    const r = await runTask(out, base, { fetch: f, stateDir: dir, credentialStore: new MemoryCredentialStore(), consentStore: new MemoryConsentStore() })
    expect(r).toMatchObject({ ok: false, reason: 'provider' })
    expect((r as { message: string }).message).toContain('cannot reach')
    expect(out.lines[0]).toContain('works offline')
  })

  it('cloud provider: says it needs the network, and without consent never makes a network call at all', async () => {
    const creds = new MemoryCredentialStore()
    await creds.set('provider:openrouter', 'sk-test')
    const { f, state } = counting(openaiOk)
    const out = sink()
    const r = await runTask(out, { ...base, kind: 'openai-compatible' }, { fetch: f, stateDir: dir, credentialStore: creds, consentStore: new MemoryConsentStore() })
    expect(r).toMatchObject({ ok: false, reason: 'consent' })
    expect(state.calls).toBe(0)
    expect(out.lines[0]).toContain('needs the network')
  })

  it('cloud provider with recorded project consent goes through both gates and completes', async () => {
    const creds = new MemoryCredentialStore()
    await creds.set('provider:openrouter', 'sk-test')
    const consentStore = new MemoryConsentStore()
    await consentStore.set({ projectId: 'p1', consented: true, decidedAt: 'now' })
    const { f, state } = counting(openaiOk)
    const r = await runTask(sink(), { ...base, kind: 'openai-compatible' }, { fetch: f, stateDir: dir, credentialStore: creds, consentStore })
    expect(r).toMatchObject({ ok: true, text: 'hi' })
    expect(state.calls).toBe(1)
  })

  it('a cloud provider with no stored key is a config error pointing at the wizard, before any boot or network', async () => {
    const { f, state } = counting(openaiOk)
    const r = await runTask(sink(), { ...base, kind: 'openai-compatible' }, { fetch: f, stateDir: dir, credentialStore: new MemoryCredentialStore(), consentStore: new MemoryConsentStore() })
    expect(r).toMatchObject({ ok: false, reason: 'config' })
    expect(state.calls).toBe(0)
  })
})
