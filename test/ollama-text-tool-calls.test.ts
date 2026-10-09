import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { ToolRegistry } from '../src/bundles/tool-registry/index.js'
import { AgentLoop } from '../src/bundles/agent-loop/index.js'
import { LLMService, OllamaProvider, recoverTextToolCalls, type ProviderRequest } from '../src/bundles/model-adapter/index.js'

// Fixtures 1-3 are the replies qwen2.5-coder:3b-instruct actually produced on the owner's machine (2026-10-04).
const OBSERVED_RAW = '{"name": "lookup_port", "arguments": {"service": "dev"}}'
const OBSERVED_FENCED_ONE_LINE = '```json {"name": "load_skill", "arguments": {"name": "release-procedure"}} ```'
const OBSERVED_SCHEMA_IN_ARGS = '{"name": "run_tests", "arguments": {"module": {"type": "string", "description": "billing"}}}'

const TOOLS = [
  { name: 'lookup_port', description: 'd', inputSchema: { type: 'object' } },
  { name: 'load_skill', description: 'd', inputSchema: { type: 'object' } },
  { name: 'run_tests', description: 'd', inputSchema: { type: 'object' } },
]
const NAMES = new Set(TOOLS.map((t) => t.name))

const reply = (message: object) => new Response(JSON.stringify({ model: 'm', message: { role: 'assistant', ...message }, done: true, done_reason: 'stop', prompt_eval_count: 1, eval_count: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })
function queued(...messages: object[]) {
  const q = [...messages]
  return (async () => reply(q.shift() ?? { content: 'out of replies' })) as unknown as typeof fetch
}
// `'omit'` sends no `tools` field at all (passing undefined would silently pick the default).
const call = (p: OllamaProvider, tools: ProviderRequest['tools'] | 'omit' = TOOLS) => p.complete({ messages: [{ role: 'user', content: 'go' }], ...(tools !== 'omit' ? { tools } : {}) })

describe('textToolCalls: recoverTextToolCalls (strict, all-or-nothing)', () => {
  const ok = (t: string) => recoverTextToolCalls(t, NAMES)

  it('recovers the replies the real model produced', () => {
    expect(ok(OBSERVED_RAW)).toEqual([{ name: 'lookup_port', input: { service: 'dev' } }])
    expect(ok(OBSERVED_FENCED_ONE_LINE)).toEqual([{ name: 'load_skill', input: { name: 'release-procedure' } }])
    expect(ok(OBSERVED_SCHEMA_IN_ARGS)).toEqual([{ name: 'run_tests', input: { module: { type: 'string', description: 'billing' } } }]) // passed through as-is; the tool's schema decides
  })

  it('accepts a fenced block (with or without a language, one line or several) and <tool_call> tags', () => {
    expect(ok('```json\n{"name":"lookup_port","arguments":{"service":"a"}}\n```')).toHaveLength(1)
    expect(ok('```\n{"name":"lookup_port","arguments":{}}\n```')).toHaveLength(1)
    expect(ok('<tool_call>\n{"name":"lookup_port","arguments":{"service":"a"}}\n</tool_call>')).toHaveLength(1)
    const two = ok('<tool_call>{"name":"lookup_port","arguments":{"service":"a"}}</tool_call>\n<tool_call>{"name":"run_tests","arguments":{"module":"b"}}</tool_call>')
    expect(two?.map((c) => c.name)).toEqual(['lookup_port', 'run_tests'])
  })

  it('arguments may be a JSON string, `parameters` is accepted as an alias, and absent arguments mean none', () => {
    expect(ok('{"name":"lookup_port","arguments":"{\\"service\\":\\"a\\"}"}')).toEqual([{ name: 'lookup_port', input: { service: 'a' } }])
    expect(ok('{"name":"lookup_port","parameters":{"service":"a"}}')).toEqual([{ name: 'lookup_port', input: { service: 'a' } }])
    expect(ok('{"name":"lookup_port"}')).toEqual([{ name: 'lookup_port', input: {} }])
  })

  it('leaves everything else alone: prose, other JSON, unknown tools, bad arguments, bad JSON', () => {
    const none = (t: string) => expect(ok(t), t).toBeUndefined()
    none('Sure! ' + OBSERVED_RAW)
    none(OBSERVED_RAW + ' Hope that helps.')
    none('```json\n' + OBSERVED_RAW + '\n```\nand then some words')
    none('<tool_call>' + OBSERVED_RAW + '</tool_call> and prose')
    none('{"answer": 42}')
    none('{"name": "not_a_tool", "arguments": {}}')
    none('{"name": 5, "arguments": {}}')
    none('[{"name": "lookup_port", "arguments": {}}]')
    none('{"name": "lookup_port", "arguments": 7}')
    none('{"name": "lookup_port", "arguments": [1]}')
    none('{"name": "lookup_port", "arguments": null}')
    none('{"name": "lookup_port", "arguments": "not json"}')
    none('{"name": "lookup_port", "arguments": ')
    none('The dev server listens on 7421.')
    none('')
    none('```json\n{broken\n```')
    // JSON that parses but is not an object, reaching the parser through a fence or tags (null would throw if unguarded)
    for (const bad of ['null', '5', '"text"', '[1]', 'true']) {
      none('```json\n' + bad + '\n```')
      none('<tool_call>' + bad + '</tool_call>')
    }
  })

  it('is all-or-nothing across several calls, and refuses an absurd number of them', () => {
    expect(ok('<tool_call>' + OBSERVED_RAW + '</tool_call><tool_call>{"name":"ghost","arguments":{}}</tool_call>')).toBeUndefined()
    const many = Array.from({ length: 9 }, () => '<tool_call>' + OBSERVED_RAW + '</tool_call>').join('')
    expect(ok(many)).toBeUndefined()
    expect(ok(Array.from({ length: 8 }, () => '<tool_call>' + OBSERVED_RAW + '</tool_call>').join(''))).toHaveLength(8)
  })
})

describe('textToolCalls: several bare JSON objects (JSON Lines), D-088', () => {
  const ok = (t: string) => recoverTextToolCalls(t, NAMES)
  const A = '{"name": "lookup_port", "arguments": {"service": "a"}}'
  const B = '{"name": "run_tests", "arguments": {"module": "b"}}'
  // The shape qwen2.5-coder:7b-instruct produced on the owner's machine (2026-10-09): two calls, one per line, code with braces and \n inside the strings.
  const OBSERVED_7B = '{"name": "lookup_port", "arguments": {"service": "src/math.js"}}\n{"name": "run_tests", "arguments": {"module": "function add(a, b) {\\n  return a - b\\n}"}}'

  it('recovers two or more objects on separate lines, back to back, or CRLF separated', () => {
    expect(ok(A + '\n' + B)?.map((c) => c.name)).toEqual(['lookup_port', 'run_tests'])
    expect(ok(A + B)?.map((c) => c.name)).toEqual(['lookup_port', 'run_tests'])
    expect(ok(A + '\r\n\r\n' + B + '\n')?.map((c) => c.name)).toEqual(['lookup_port', 'run_tests'])
    expect(ok(A + '\n' + A + '\n' + B)).toHaveLength(3)
  })
  it('the observed 7B reply: braces and escaped newlines inside the argument strings do not confuse it', () => {
    const r = ok(OBSERVED_7B)!
    expect(r).toHaveLength(2)
    expect(r[1]!.input).toEqual({ module: 'function add(a, b) {\n  return a - b\n}' })
  })
  it('braces and quotes inside strings are not structure', () => {
    const tricky = '{"name": "lookup_port", "arguments": {"service": "}{ \\" } {"}}\n' + B
    const r = ok(tricky)!
    expect(r).toHaveLength(2)
    expect(r[0]!.input).toEqual({ service: '}{ " } {' })
  })
  it('a lone brace inside a string does not end or extend an object', () => {
    for (const lone of ['}', '{', '}}', '{{']) {
      const r = ok('{"name": "lookup_port", "arguments": {"service": ' + JSON.stringify(lone) + '}}\n' + B)
      expect(r?.map((c) => c.name), lone).toEqual(['lookup_port', 'run_tests'])
      expect(r![0]!.input).toEqual({ service: lone })
    }
  })
  it('still all-or-nothing: prose between or around, an unknown tool, an array, a broken object, or too many', () => {
    const none = (t: string) => expect(ok(t), t).toBeUndefined()
    none(A + '\nand then I will run the tests\n' + B)
    none(A + '\n' + B + '\nDone!')
    none('Sure:\n' + A + '\n' + B)
    none(A + ',\n' + B)
    none(A + '\n{"name": "ghost", "arguments": {}}')
    none(A + '\n[' + B + ']')
    none(A + '\n{"name": "run_tests", "arguments": {"module": "b"}')
    none(A + '\n{"name": "run_tests", "arguments": {"module": "b"}}}')
    none(A + '\n{"name": "run_tests", "arguments": 5}')
    expect(ok(Array.from({ length: 8 }, () => A).join('\n'))).toHaveLength(8)
    none(Array.from({ length: 9 }, () => A).join('\n'))
  })
})

describe('textToolCalls: in the Ollama provider', () => {
  it('JSON Lines in one reply become real tool calls, in order, with unique ids (D-088)', async () => {
    const p = new OllamaProvider({ model: 'm', textToolCalls: true, fetch: queued({ content: '{"name": "lookup_port", "arguments": {"service": "a"}}\n{"name": "run_tests", "arguments": {"module": "b"}}' }) })
    const r = await call(p)
    expect(r.toolCalls.map((c) => c.name)).toEqual(['lookup_port', 'run_tests'])
    expect(new Set(r.toolCalls.map((c) => c.id)).size).toBe(2)
    expect(r.text).toBe('')
    expect(r.stopReason).toBe('tool_use')
    expect(r.recoveredToolCalls).toBe(2)
  })
  it('is OFF by default: the same reply stays a plain text answer (the failure the owner saw)', async () => {
    const r = await call(new OllamaProvider({ model: 'm', fetch: queued({ content: OBSERVED_RAW }) }))
    expect(r.toolCalls).toEqual([])
    expect(r.text).toBe(OBSERVED_RAW)
    expect(r.stopReason).toBe('end_turn')
    expect(r.recoveredToolCalls).toBeUndefined()
  })

  it('when on, turns the reply into a real tool call: no text, stopReason tool_use, unique ids, a count', async () => {
    const p = new OllamaProvider({ model: 'm', textToolCalls: true, fetch: queued({ content: '<tool_call>' + OBSERVED_RAW + '</tool_call><tool_call>' + OBSERVED_RAW + '</tool_call>' }) })
    const r = await call(p)
    expect(r.toolCalls).toHaveLength(2)
    expect(r.toolCalls[0]).toMatchObject({ name: 'lookup_port', input: { service: 'dev' } })
    expect(new Set(r.toolCalls.map((c) => c.id)).size).toBe(2)
    expect(r.text).toBe('')
    expect(r.content.every((b) => b.type === 'tool_use')).toBe(true)
    expect(r.stopReason).toBe('tool_use')
    expect(r.recoveredToolCalls).toBe(2)
  })

  it('only when tools were offered in THIS request, and only for the tools offered', async () => {
    const mk = () => new OllamaProvider({ model: 'm', textToolCalls: true, fetch: queued({ content: OBSERVED_RAW }, { content: OBSERVED_RAW }, { content: OBSERVED_RAW }) })
    const p = mk()
    expect((await call(p, 'omit')).toolCalls).toEqual([]) // no tools in the request
    expect((await call(p, [])).toolCalls).toEqual([]) // empty tool list
    const other = await call(p, [{ name: 'run_tests', description: 'd', inputSchema: { type: 'object' } }]) // lookup_port exists elsewhere but was not offered
    expect(other.toolCalls).toEqual([])
    expect(other.text).toBe(OBSERVED_RAW)
  })

  it('a model that uses the proper tool-call channel is untouched, even if its text looks like a call', async () => {
    const p = new OllamaProvider({
      model: 'm',
      textToolCalls: true,
      fetch: queued({ content: OBSERVED_RAW, tool_calls: [{ function: { name: 'run_tests', arguments: { module: 'x' } } }] }),
    })
    const r = await call(p)
    expect(r.toolCalls).toHaveLength(1)
    expect(r.toolCalls[0]).toMatchObject({ name: 'run_tests', input: { module: 'x' } })
    expect(r.text).toBe(OBSERVED_RAW) // kept as the model's own text
    expect(r.recoveredToolCalls).toBeUndefined()
  })

  it('ordinary answers are untouched when on', async () => {
    const r = await call(new OllamaProvider({ model: 'm', textToolCalls: true, fetch: queued({ content: 'The port is 7421.' }) }))
    expect(r).toMatchObject({ text: 'The port is 7421.', toolCalls: [], stopReason: 'end_turn' })
  })
})

describe('textToolCalls: through the real loop, registry and log', () => {
  async function boot(textToolCalls: boolean, ...replies: object[]) {
    const ctx = new Context()
    await ctx.plugin(SessionLog, { memory: true })
    await ctx.plugin(EgressPolicy, { projectId: 'test' })
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LLMService, { ollama: { model: 'm', textToolCalls, fetch: queued(...replies) } })
    const ran: unknown[] = []
    ctx.tools.register({
      name: 'lookup_port',
      description: 'Look up a port.',
      actionClass: 'read-only',
      inputSchema: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] },
      execute: (i: { service: string }) => (ran.push(i), 'the dev server listens on port 7421'),
    })
    ctx.tools.register({
      name: 'run_tests',
      description: 'Run tests.',
      actionClass: 'read-only',
      inputSchema: { type: 'object', properties: { module: { type: 'string' } }, required: ['module'] },
      execute: (i: { module: string }) => (ran.push(i), `PASSED ${i.module}`),
    })
    await ctx.plugin(AgentLoop, { sleep: async () => {}, retry: { maxAttempts: 0 } })
    return { ctx, ran }
  }

  it('REGRESSION of the real failure: with the option off the loop ends at step 1 and the JSON is the "answer", no tool runs', async () => {
    const { ctx, ran } = await boot(false, { content: OBSERVED_RAW })
    const r = await ctx.agentLoop.run({ sessionId: ctx.log.create('s'), prompt: 'port?' })
    expect(r.steps).toBe(1)
    expect(r.finalText).toBe(OBSERVED_RAW)
    expect(ran).toEqual([])
  })

  it('with it on, the recovered call runs the real tool, the model answers, and the log marks the recovery', async () => {
    const { ctx, ran } = await boot(true, { content: OBSERVED_RAW }, { content: 'The dev server listens on 7421.' })
    const s = ctx.log.create('s')
    const r = await ctx.agentLoop.run({ sessionId: s, prompt: 'port?' })
    expect(ran).toEqual([{ service: 'dev' }])
    expect(r.finalText).toBe('The dev server listens on 7421.')
    expect(r.steps).toBe(2)
    const log = await ctx.log.read(s)
    const responses = log.filter((e) => e.type === 'model.response').map((e) => e.data as { recoveredToolCalls?: number })
    expect(responses[0]!.recoveredToolCalls).toBe(1) // visible: this call came from text
    expect(responses[1]!.recoveredToolCalls).toBeUndefined()
    expect(log.filter((e) => e.type === 'tool.call')).toHaveLength(1)
  })

  it('the model\'s schema-in-arguments mistake is NOT repaired: the tool\'s own schema rejects it, and the model can retry', async () => {
    const { ctx, ran } = await boot(true, { content: OBSERVED_SCHEMA_IN_ARGS }, { content: '{"name": "run_tests", "arguments": {"module": "billing"}}' }, { content: 'All tests passed.' })
    const s = ctx.log.create('s')
    const r = await ctx.agentLoop.run({ sessionId: s, prompt: 'run the billing tests' })
    expect(ran).toEqual([{ module: 'billing' }]) // only the corrected call executed
    expect(r.finalText).toBe('All tests passed.')
    const results = (await ctx.log.read(s)).filter((e) => e.type === 'tool.result').map((e) => JSON.stringify(e.data))
    expect(results[0]).toMatch(/invalid/i)
  })
})
