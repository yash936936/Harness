import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bootProfileCoding } from '../src/profiles/profile-coding.js'
import { MockProvider } from '../src/bundles/model-adapter/index.js'
import { parseTimeoutMs } from '../src/cli/code.js'

const roots: string[] = []
afterEach(() => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }) })
function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'harness-code-')); roots.push(root)
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'README.md'), 'prototype')
  return root
}
const reply = (v: unknown) => ({ text: typeof v === 'string' ? v : JSON.stringify(v) })
const plan = reply({ subtasks: [{ id: 'readme', goal: 'Read README.md', tools: ['read_file'], dependsOn: [] }] })

describe('governed profile code path', () => {
  it('returns a clear failure when projectRoot is a file rather than a directory', async () => {
    const root = makeProject()
    const { runCodeTask } = await import('../src/cli/code.js')
    const output: string[] = []
    const io = { print: (line: string) => output.push(line), ask: async () => '', confirm: async () => false }
    const result = await runCodeTask(io, {
      task: 'inspect', projectRoot: join(root, 'README.md'), provider: 'ollama', model: 'demo', dockerAvailable: false,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/not a directory/)
    expect(output.join('\n')).toContain('not a directory')
  })

  it('runs planner and sub-agent against a scripted provider, recording the session', async () => {
    const root = makeProject()
    const ctx = await bootProfileCoding({
      projectId: 'scripted', projectRoot: root, sessionLog: { path: join(root, '.harness', 'sessions') },
      modelAdapter: { ollama: { model: 'scripted' } }, orchestrator: { maxRepairs: 0 },
    })
    const mock = new MockProvider([
      plan,
      {
        toolCalls: [{ id: 'readme-read', name: 'read_file', input: { path: 'README.md' } }],
        content: [{ type: 'tool_use', id: 'readme-read', name: 'read_file', input: { path: 'README.md' } }],
      },
      reply('README contains prototype.'),
    ])
    ctx.llm.register('scripted', mock, { default: true })
    const sid = ctx.log.create()
    const tools = ctx.tools.list().map(t => t.name).filter(n => n !== 'run_command')
    await ctx.log.append(sid, 'code.started', { root, tools }, 'test')
    const p = await ctx.orchestrator.plan({ sessionId: sid, task: 'Read README.md', tools, provider: 'scripted' })
    const result = await ctx.orchestrator.execute(p.plan, { sessionId: sid, allowedTools: tools, provider: 'scripted' })
    const events = await ctx.log.read(sid)
    expect(result.status).toBe('completed')
    expect(events.map(e => e.type)).toContain('plan.created')
    expect(events.map(e => e.type)).toContain('execute.finished')
    expect(events.map(e => e.type)).toContain('tool.call')
    expect(events.map(e => e.type)).not.toContain('approval.pending')
    expect(tools).not.toContain('run_command')
    await ctx.fiber.dispose()
  })

  it('holds and logs a file-write approval before touching disk', async () => {
    const root = makeProject()
    let approvalCalled = false
    const ctx = await bootProfileCoding({
      projectId: 'approval', projectRoot: root, sessionLog: { memory: true },
      modelAdapter: { ollama: { model: 'scripted' } },
      policy: { approver: async () => { approvalCalled = true; return { approve: true, by: 'terminal-test' } } },
    })
    const sid = ctx.log.create()
    await ctx.tools.call('write_file', { path: 'approved.txt', content: 'approved', confidence: 0 }, { sessionId: sid })
    const events = await ctx.log.read(sid)
    expect(approvalCalled).toBe(true)
    expect(events.map(e => e.type)).toContain('approval.pending')
    expect(events.map(e => e.type)).toContain('approval.resolved')
    expect(readFileSync(join(root, 'approved.txt'), 'utf8')).toBe('approved')
    await ctx.fiber.dispose()
  })

  it('refuses OpenRouter before any request when the environment key is missing', async () => {
    const prior = process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_API_KEY
    try {
      const { runCodeTask } = await import('../src/cli/code.js')
      const output: string[] = []
      const io = { print: (line: string) => output.push(line), ask: async () => '', confirm: async () => false }
      const result = await runCodeTask(io, {
        task: 'inspect', projectRoot: makeProject(), provider: 'openrouter', model: 'demo/model:free', dockerAvailable: false,
      })
      expect(result.ok).toBe(false)
      expect(output.join('\n')).toContain('BLOCKED-KEY')
    } finally {
      if (prior !== undefined) process.env.OPENROUTER_API_KEY = prior
    }
  })

  it('names the configured endpoint and API-key disclosure before requesting remote consent', async () => {
    const prior = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = 'test-key'
    const prompts: string[] = []
    const output: string[] = []
    try {
      const { runCodeTask } = await import('../src/cli/code.js')
      const io = {
        print: (line: string) => output.push(line),
        ask: async () => '',
        confirm: async (prompt: string) => { prompts.push(prompt); return false },
      }
      const result = await runCodeTask(io, {
        task: 'inspect', projectRoot: makeProject(), provider: 'openrouter', model: 'demo/model:free',
        baseUrl: 'https://gateway.example.test/v1', dockerAvailable: false,
      })
      expect(result.ok).toBe(false)
      expect(prompts[0]).toContain('gateway.example.test')
      expect(prompts[0]).toContain('API key')
      expect(output.join('\\n')).toContain('OPENROUTER_API_KEY to gateway.example.test')
    } finally {
      if (prior === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = prior
    }
  })
})


describe('Ollama CLI timeout option', () => {
  it('leaves the provider default unchanged when omitted', () => {
    expect(parseTimeoutMs(undefined)).toBeUndefined()
  })

  it('accepts a positive safe integer number of milliseconds', () => {
    expect(parseTimeoutMs('300000')).toBe(300000)
    expect(parseTimeoutMs('1')).toBe(1)
    expect(parseTimeoutMs('4294967295')).toBe(4294967295)
  })

  it.each(['0', '-1', '1.5', 'Infinity', 'NaN', '', '9007199254740992', '4294967296', '1e3'])(
    'rejects invalid timeout value %j',
    (value) => {
      expect(() => parseTimeoutMs(value)).toThrow('--timeout-ms must be an integer from 1 to 4294967295 milliseconds')
    },
  )
})
