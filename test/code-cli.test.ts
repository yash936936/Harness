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

  it('rejects cleartext HTTP OpenRouter endpoints before consent or provider startup', async () => {
    const prior = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = 'test-key'
    const prompts: string[] = []
    const output: string[] = []
    try {
      const { runCodeTask } = await import('../src/cli/code.js')
      const io = {
        print: (line: string) => output.push(line),
        ask: async () => '',
        confirm: async (prompt: string) => { prompts.push(prompt); return true },
      }
      const result = await runCodeTask(io, {
        task: 'inspect', projectRoot: makeProject(), provider: 'openrouter', model: 'demo/model:free',
        baseUrl: 'http://gateway.example.test/v1', dockerAvailable: false,
      })
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('invalid OpenRouter endpoint')
      expect(prompts).toHaveLength(0)
      expect(output.join('\n')).toContain('expected an HTTPS URL')
    } finally {
      if (prior === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = prior
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
      expect(output.join('\n')).toContain('OPENROUTER_API_KEY to gateway.example.test')
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


describe('governed CLI policy acceptance', () => {
  it('records a held package manifest edit, terminal denial, and hard-denied credential read without touching the project', async () => {
    const root = makeProject()
    const manifest = '"name": "coding-harness"'
    const originalManifest = `{\n  ${manifest},\n  "version": "0.0.1"\n}\n`
    writeFileSync(join(root, 'package.json'), originalManifest)

    const previousFetch = globalThis.fetch
    const requests: Array<{ tools?: unknown[]; messages?: unknown[] }> = []
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { tools?: unknown[]; messages?: unknown[] }
      requests.push(body)
      const hasTools = Array.isArray(body.tools) && body.tools.length > 0
      const afterToolResult = Array.isArray(body.messages) && body.messages.some((message) => (message as { role?: string }).role === 'tool')
      const payload = !hasTools
        ? {
            model: 'scripted',
            done: true,
            done_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify({
                subtasks: [{
                  id: 'policy-check',
                  goal: 'Attempt the package manifest edit and protected credential read.',
                  tools: ['edit_file', 'read_file'],
                  dependsOn: [],
                }],
              }),
            },
          }
        : afterToolResult
          ? {
              model: 'scripted',
              done: true,
              done_reason: 'stop',
              message: { role: 'assistant', content: 'Both requested tool attempts were processed.' },
            }
          : {
              model: 'scripted',
              done: true,
              done_reason: 'stop',
              message: {
                role: 'assistant',
                content: [
                  JSON.stringify({
                    name: 'edit_file',
                    parameters: {
                      path: 'package.json',
                      old_string: manifest,
                      new_string: manifest,
                      confidence: '1',
                    },
                  }),
                  JSON.stringify({ name: 'read_file', parameters: { path: '.env.production' } }),
                ].join('\n'),
              },
            }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const prompts: string[] = []
    const output: string[] = []
    const io = {
      print: (line: string) => output.push(line),
      ask: async () => '',
      confirm: async (prompt: string) => {
        prompts.push(prompt)
        return false
      },
    }

    let result: Awaited<ReturnType<typeof import('../src/cli/code.js').runCodeTask>> | undefined
    try {
      const { runCodeTask } = await import('../src/cli/code.js')
      result = await runCodeTask(io, {
        task: 'Use edit_file to replace the exact text "' + manifest + '" with the same text in package.json. Then attempt read_file on .env.production. Do not request or reveal its contents.',
        projectRoot: root,
        provider: 'ollama',
        model: 'scripted',
        baseUrl: 'http://127.0.0.1:11434',
        sandbox: 'none',
        textToolCalls: true,
        dockerAvailable: false,
      })

      const trace = await result.context!.log.read(result.sessionId!)
      const modelResponses = trace.filter((event) => event.type === 'model.response').map((event) => {
        const data = event.data as { recoveredToolCalls?: number; toolCalls?: Array<{ name: string }> }
        return { recoveredToolCalls: data.recoveredToolCalls, toolCalls: data.toolCalls?.map((call) => call.name) }
      })
      const actualCalls = trace.filter((event) => event.type === 'tool.call').map((event) => (event.data as { name: string }).name)
      expect(result.ok, JSON.stringify({ output, modelResponses, actualCalls })).toBe(true)
      expect(requests.length).toBeGreaterThanOrEqual(2)
      const offeredToolNames = requests.flatMap((request) => (request.tools ?? []).map((tool) => (tool as { function?: { name?: string } }).function?.name))
      expect(offeredToolNames).toContain('edit_file')
      expect(offeredToolNames).toContain('read_file')
      expect(offeredToolNames).not.toContain('run_command')
      expect(prompts).toHaveLength(1)
      expect(prompts[0]).toContain('Approve this exact operation?')
      expect(output.join('\n')).toContain('no sandbox: commands disabled, file tools still gated')
      expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(originalManifest)

      const events = await result.context!.log.read(result.sessionId!)
      const calls = events.filter((event) => event.type === 'tool.call').map((event) => (event.data as { name: string }).name)
      expect(calls).toEqual(['edit_file', 'read_file'])
      const normalizedInput = events.find((event) => event.type === 'tool.input.normalized' && (event.data as { name?: string }).name === 'edit_file')
      expect(normalizedInput?.data).toMatchObject({ input: { old_string: manifest, new_string: manifest, confidence: 1 } })
      const decisions = events.filter((event) => event.type === 'policy.decision')
      const heldEdit = decisions.find((event) => {
        const data = event.data as { tool?: string; verdict?: string }
        return data.tool === 'edit_file' && data.verdict === 'hold'
      })
      expect(heldEdit).toBeDefined()
      expect((heldEdit!.data as { signals: Array<{ name: string; score: number }> }).signals)
        .toContainEqual(expect.objectContaining({ name: 'path-criticality', score: 0.5 }))

      const deniedRead = decisions.find((event) => {
        const data = event.data as { tool?: string; verdict?: string; rule?: string }
        return data.tool === 'read_file' && data.verdict === 'deny' && data.rule === 'credential-path'
      })
      expect(deniedRead).toBeDefined()

      const pending = events.filter((event) => event.type === 'approval.pending')
      expect(pending).toHaveLength(1)
      expect((pending[0]!.data as { tool: string }).tool).toBe('edit_file')

      const resolved = events.filter((event) => event.type === 'approval.resolved')
      expect(resolved).toHaveLength(1)
      expect((resolved[0]!.data as { outcome: string }).outcome).toBe('denied')
      expect(events.some((event) =>
        event.type === 'approval.pending' &&
        (event.data as { tool?: string }).tool === 'read_file',
      )).toBe(false)
    } finally {
      globalThis.fetch = previousFetch
      await result?.context?.fiber.dispose()
    }
  })
})
