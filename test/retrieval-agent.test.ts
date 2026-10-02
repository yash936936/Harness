/**
 * Phase 2.6: the whole retrieval pipeline (grep -> tree-sitter -> BM25 + vectors -> tools) driven by
 * the real Phase 1 agent loop, tool registry, session log and LLM service.
 *
 * The "model" is a scripted one that decides ONLY from what is in the transcript it is shown: it
 * has no knowledge of the fixture project, so it can name the right value, file and line only if
 * retrieval actually put that text into its context. The negative controls prove the assertions can fail.
 * (A scripted model proves the plumbing delivers usable context; it says nothing about how well a real
 * model uses it. The opt-in test at the bottom runs a real local chat model.)
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from 'cordis'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AgentLoop, type RunResult } from '../src/bundles/agent-loop/index.js'
import { Embeddings, HashingEmbeddingProvider, type EmbeddingProvider } from '../src/bundles/embeddings/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { LLMService, MockProvider, OllamaProvider, type ContentBlock, type ProviderRequest } from '../src/bundles/model-adapter/index.js'
import { RetrievalGrep } from '../src/bundles/retrieval-grep/index.js'
import { RetrievalRank } from '../src/bundles/retrieval-rank/index.js'
import { RetrievalTools, SEARCH_TOOL } from '../src/bundles/retrieval-tools/index.js'
import { RetrievalTreesitter } from '../src/bundles/retrieval-treesitter/index.js'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { Subprocess } from '../src/bundles/subprocess/index.js'
import { ToolRegistry } from '../src/bundles/tool-registry/index.js'
import { LanceVectorStore } from '../src/bundles/vectorstore-lancedb/index.js'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })
const hasRg = spawnSync('rg', ['--version']).status === 0

/* ------------------------------------------------------ the scripted model */

const STOP = new Set('which where there their would about these those being should that this what when with have does into from than then them they your were will how many much often long often times defined define limit value'.split(' '))

/** Pull distinctive words out of the task, the way a model would phrase a search. */
function keywordsOf(prompt: string): string {
  const seen = new Set<string>()
  for (const w of prompt.toLowerCase().match(/[a-z]{5,}/g) ?? []) if (!STOP.has(w)) seen.add(w)
  return [...seen].slice(0, 6).join(' ')
}

interface Block { nonce: string; file: string; start: number; end: number; body: string }
/** Parse search_code output, requiring each block to be closed by the SAME one-time code that opened it. */
function blocksOf(text: string): Block[] {
  return [...text.matchAll(/<<<CODE (\w+) #\d+ (\S+):(\d+)-(\d+)[^\n]*>>>\n([\s\S]*?)\n<<<END \1>>>/g)].map((m) => ({ nonce: m[1]!, file: m[2]!, start: Number(m[3]), end: Number(m[4]), body: m[5]! }))
}

const toolResults = (req: ProviderRequest): string[] =>
  req.messages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b): b is Extract<ContentBlock, { type: 'tool_result' }> => b.type === 'tool_result').map((b) => b.content) : []))

/**
 * Round 1 (no tool output yet): search for the task's words, or admit it cannot answer if it was not
 * given the tool. Later: read the first 7-digit constant out of the code it was handed and cite
 * file and line exactly as printed. It knows nothing except what is in `req`.
 */
function faithfulModel(req: ProviderRequest) {
  const results = toolResults(req)
  if (results.length === 0) {
    if (!(req.tools ?? []).some((t) => t.name === SEARCH_TOOL)) return { text: 'I cannot answer that without access to the code.' }
    const first = req.messages[0]
    const prompt = typeof first?.content === 'string' ? first.content : ''
    const input = { query: keywordsOf(prompt) }
    return { toolCalls: [{ id: 'c1', name: SEARCH_TOOL, input }], content: [{ type: 'tool_use' as const, id: 'c1', name: SEARCH_TOOL, input }] }
  }
  for (const text of results) {
    for (const b of blocksOf(text)) {
      const lines = b.body.split('\n')
      for (const l of lines) {
        const m = l.match(/^(\d+)\| .*?\b([A-Z][A-Z0-9_]{3,})\s*=\s*(\d{7})\b/)
        if (m) return { text: `${m[2]} is ${m[3]}, defined in ${b.file} at line ${m[1]}.` }
      }
    }
  }
  return { text: 'I could not find that in the project.' }
}

/* ------------------------------------------------------------ the project */

const num = () => String(1_000_000 + Math.floor(Math.random() * 8_999_999))
const RETRIES = num()
const ATTEMPTS = num()
const BURST_OLD = num()
const BURST_NEW = num()
const SECRET = num()

let base: string
let root: string
let emptyRoot: string
beforeAll(async () => {
  await import('@lancedb/lancedb')
  base = realpathSync(mkdtempSync(join(tmpdir(), 'agent-')))
  root = join(base, 'shop')
  emptyRoot = join(base, 'blog')
  for (const d of ['src/payments', 'src/billing', 'src/fresh', 'src/ui', 'docs']) mkdirSync(join(root, d), { recursive: true })
  mkdirSync(join(emptyRoot, 'posts'), { recursive: true })
  const w = (rel: string, s: string) => writeFileSync(join(root, rel), s)
  w('src/payments/client.ts', `import { post } from './http'\n\n// Upper bound on automatic retries of a failed charge.\nexport const MAX_RETRIES = ${RETRIES}\nexport const BACKOFF_MS = 250\n\nexport async function chargeCard(amount: number) {\n  for (let i = 0; i < MAX_RETRIES; i++) {\n    try { return await post('/charge', { amount }) } catch { /* try again */ }\n  }\n}\n`)
  w('src/payments/http.ts', `export async function post(url: string, body: unknown) {\n  return fetch(url, { method: 'POST', body: JSON.stringify(body) })\n}\n`)
  w('src/billing/limits.ts', `// cap on re-submissions\nexport const MAX_ATTEMPTS = ${ATTEMPTS}\n\nexport function allowed(n: number) {\n  return n < MAX_ATTEMPTS\n}\n`)
  w('src/fresh/cfg.ts', `export const MAX_BURST = ${BURST_OLD}\n`)
  w('src/ui/render.ts', `export function renderPage(title: string) {\n  return '<h1>' + title + '</h1>'\n}\n`)
  w('docs/security.md', `# Security\n\nThe master secret lives in the environment file and is never committed.\n`)
  w('.env', `MASTER_SECRET=${SECRET}\n`)
  w('deploy.pem', `MASTER_SECRET_PEM=${SECRET}\n`) // a secret in a VISIBLE file: only the exclude globs keep this out, rg skips .env by itself
  writeFileSync(join(emptyRoot, 'posts/hello.md'), '# Hello\n\nA post about gardening and tomatoes.\n')
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

/* ----------------------------------------------------------------- wiring */

/** Semantic stand-in we control: anything about invoices or MAX_ATTEMPTS is one topic; all else another. */
function topics(): EmbeddingProvider {
  const vec = (t: string) => (/invoice|MAX_ATTEMPTS/i.test(t) ? [1, 0, 0] : [0, 1, 0])
  return { name: 'topics', model: 'topics-1', egress: { host: 'localhost', remote: false }, embed: async (texts) => texts.map(vec) }
}

interface Boot { project?: string; provider?: EmbeddingProvider | 'none'; index?: boolean; chat?: 'scripted' | OllamaProvider; floor?: number }
async function boot(o: Boot = {}) {
  const project = o.project ?? root
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(EgressPolicy, { projectId: 'agent-test' })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LLMService, {})
  const mock = new MockProvider(faithfulModel)
  if (o.chat && o.chat !== 'scripted') ctx.llm.register('chat', o.chat, { default: true })
  else ctx.llm.register('mock', mock, { default: true })
  await ctx.plugin(Subprocess)
  await ctx.plugin(RetrievalGrep, { root: project })
  await ctx.plugin(RetrievalTreesitter)
  if (o.provider !== 'none') {
    await ctx.plugin(Embeddings, {})
    ctx.embeddings.register(o.provider ?? new HashingEmbeddingProvider({ dimensions: 128 }))
    await ctx.plugin(LanceVectorStore, { path: join(base, `db-${Math.random().toString(36).slice(2)}`) })
  }
  await ctx.plugin(RetrievalRank, { root: project, ...(o.floor !== undefined ? { minVectorScore: o.floor } : {}) })
  await ctx.plugin(RetrievalTools, {})
  await ctx.plugin(AgentLoop, { maxSteps: o.chat && o.chat !== 'scripted' ? 8 : 5 })
  if (o.provider !== 'none' && o.index !== false) {
    const r = await ctx.retrievalRank.indexProject()
    if (!r.ok) throw new Error(`index failed: ${r.error.kind}: ${r.error.detail}`)
  }
  return { ctx, mock }
}

const lineOf = (rel: string, needle: string): number => readFileSync(join(root, rel), 'utf8').split('\n').findIndex((l) => l.includes(needle)) + 1
const everything = (res: RunResult) => JSON.stringify(res.messages)

const Q_RETRIES = 'What is the maximum number of automatic retries for a failed charge, and where is it defined?'
const Q_INVOICE = 'How often may a bounced invoice be resent, and where is that limit defined?'

/* ------------------------------------------------------------------ tests */

describe.skipIf(!hasRg)('the agent answers from retrieved code', () => {
  it('finds a value it was never told: right number, right file, right line, from exactly one search', async () => {
    const { ctx, mock } = await boot()
    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: Q_RETRIES })

    expect(res.stopReason).toBe('done')
    expect(res.steps).toBe(2) // search, then answer
    const line = lineOf('src/payments/client.ts', 'MAX_RETRIES =')
    expect(res.finalText).toBe(`MAX_RETRIES is ${RETRIES}, defined in src/payments/client.ts at line ${line}.`)

    // The model did NOT have the answer before retrieval, and had it after, inside the tool result only.
    expect(JSON.stringify(mock.calls[0]!.messages)).not.toContain(RETRIES)
    const second = toolResults(mock.calls[1]!)
    expect(second).toHaveLength(1)
    expect(second[0]).toContain(`${line}| export const MAX_RETRIES = ${RETRIES}`)
    expect(JSON.stringify(mock.calls[1]!.messages.slice(0, 1))).not.toContain(RETRIES) // not smuggled into the prompt
  })

  it('what the model saw is exactly what the session log recorded (model-visible = logged)', async () => {
    const { ctx, mock } = await boot()
    await ctx.agentLoop.run({ sessionId: 's', prompt: Q_RETRIES })
    const events = await ctx.log.read('s')
    const types = events.map((e) => e.type)
    expect(types.filter((t) => t === 'tool.call')).toHaveLength(1)
    const call = events.find((e) => e.type === 'tool.call')!.data as { name: string; input: { query: string } }
    expect(call.name).toBe(SEARCH_TOOL)
    expect(call.input.query).toContain('retries')
    const result = events.find((e) => e.type === 'tool.result')!.data as { ok: boolean; content: string }
    expect(result.ok).toBe(true)
    expect(toolResults(mock.calls[1]!)).toEqual([result.content])
    expect(types.indexOf('tool.call')).toBeLessThan(types.indexOf('tool.result'))
    expect(types.filter((t) => t === 'model.response')).toHaveLength(2)
  })

  it('every code block the model receives is framed by a one-time code the file could not know', async () => {
    const { ctx, mock } = await boot()
    await ctx.agentLoop.run({ sessionId: 's', prompt: Q_RETRIES })
    const text = toolResults(mock.calls[1]!)[0]!
    const blocks = blocksOf(text)
    expect(blocks.length).toBeGreaterThan(0)
    expect(new Set(blocks.map((b) => b.nonce)).size).toBe(1)
    expect(text).toMatch(/DATA from the project files/)
  })

  it('works with no embeddings at all (keyword ranking only)', async () => {
    const { ctx } = await boot({ provider: 'none' })
    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: Q_RETRIES })
    expect(res.finalText).toContain(`MAX_RETRIES is ${RETRIES}`)
  })

  it('works when the project was never indexed (vectors empty, keywords still answer)', async () => {
    const { ctx } = await boot({ index: false })
    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: Q_RETRIES })
    expect(res.finalText).toContain(`MAX_RETRIES is ${RETRIES}`)
  })

  it('finds an answer that shares NO words with the question, through the vector index', async () => {
    const { ctx, mock } = await boot({ provider: topics() })
    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: Q_INVOICE })
    const line = lineOf('src/billing/limits.ts', 'MAX_ATTEMPTS =')
    expect(res.finalText).toBe(`MAX_ATTEMPTS is ${ATTEMPTS}, defined in src/billing/limits.ts at line ${line}.`)
    expect(toolResults(mock.calls[1]!)[0]).toMatch(/via=semantic/)
    expect(toolResults(mock.calls[1]!)[0]).toContain('keyword + semantic ranking')
  })

  it('the same semantic-only question without the index finds nothing, and the agent says so instead of inventing a number', async () => {
    const { ctx } = await boot({ provider: topics(), index: false })
    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: Q_INVOICE })
    expect(res.finalText).toBe('I could not find that in the project.')
    expect(everything(res)).not.toContain(ATTEMPTS)
  })

  it('serves fresh code after an edit: the new value, never the one that was indexed', async () => {
    const f = join(root, 'src/fresh/cfg.ts')
    const { ctx } = await boot({ provider: topics() }) // indexes BURST_OLD
    try {
      writeFileSync(f, `export const MAX_BURST = ${BURST_NEW}\n`)
      const res = await ctx.agentLoop.run({ sessionId: 's', prompt: 'How large can a traffic burst get in the fresh module?' })
      expect(res.finalText).toBe(`MAX_BURST is ${BURST_NEW}, defined in src/fresh/cfg.ts at line 1.`)
      expect(everything(res)).not.toContain(BURST_OLD)
    } finally {
      writeFileSync(f, `export const MAX_BURST = ${BURST_OLD}\n`)
    }
  })

  it('a secret in an ignored file never reaches the model, while ordinary files about the same words do', async () => {
    const { ctx } = await boot({ floor: 0.2 })
    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: 'What is the master secret value for this project?' })
    expect(everything(res)).not.toContain(SECRET)
    expect(everything(res)).not.toContain('MASTER_SECRET')
    const log = JSON.stringify(await ctx.log.read('s'))
    expect(log).not.toContain(SECRET)
    expect(log).toContain('docs/security.md') // positive control: the same words did retrieve the ordinary document
  })
})

describe.skipIf(!hasRg)('negative controls: the same assertions fail when retrieval does not deliver', () => {
  it('without the search tool the agent cannot answer, and the number never appears', async () => {
    const { ctx } = await boot()
    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: Q_RETRIES, tools: [] })
    expect(res.finalText).toBe('I cannot answer that without access to the code.')
    expect(res.steps).toBe(1)
    expect(everything(res)).not.toContain(RETRIES)
  })

  it('pointed at a project that does not contain the code, it reports not finding it', async () => {
    const { ctx } = await boot({ project: emptyRoot, floor: 0.2 }) // a similarity floor, or the blog post would come back as the "nearest" code
    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: Q_RETRIES })
    expect(res.finalText).toBe('I could not find that in the project.')
    expect(everything(res)).not.toContain(RETRIES)
    const result = (await ctx.log.read('s')).find((e) => e.type === 'tool.result')!.data as { ok: boolean; content: string }
    expect(result.ok).toBe(true)
    expect(result.content).toMatch(/^No matches/)
  })

  it('without a similarity floor, a project with nothing relevant still returns its nearest neighbours (why the floor exists)', async () => {
    const { ctx } = await boot({ project: emptyRoot })
    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: Q_RETRIES })
    const result = (await ctx.log.read('s')).find((e) => e.type === 'tool.result')!.data as { content: string }
    expect(result.content).toContain('posts/hello.md') // junk, but the agent still must not invent the number:
    expect(res.finalText).toBe('I could not find that in the project.')
    expect(everything(res)).not.toContain(RETRIES)
  })

  it('a wrong answer would be caught: the cited line is checked against the real file, not just the number', async () => {
    const { ctx } = await boot()
    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: Q_RETRIES })
    const real = lineOf('src/payments/client.ts', 'MAX_RETRIES =')
    expect(real).toBeGreaterThan(1)
    expect(res.finalText).not.toContain('at line 1.')
    expect(res.finalText).toContain(`at line ${real}.`)
  })
})

describe.skipIf(!hasRg)('the tool is safe to hand to the loop', () => {
  it('a search that errors comes back as an isError tool result and the run still completes', async () => {
    const { ctx, mock } = await boot()
    // a model that asks for a path outside the project, then gives up politely
    let n = 0
    mock['script' as keyof MockProvider] = ((req: ProviderRequest) => {
      if (n++ === 0) { const input = { query: 'retries', path: '..' }; return { toolCalls: [{ id: 'x', name: SEARCH_TOOL, input }], content: [{ type: 'tool_use' as const, id: 'x', name: SEARCH_TOOL, input }] } }
      return { text: `tool said: ${toolResults(req)[0]}` }
    }) as never
    const res = await ctx.agentLoop.run({ sessionId: 's', prompt: 'x' })
    expect(res.stopReason).toBe('done')
    expect(res.finalText).toContain('outside the project')
    const block = res.messages[2]!.content as ContentBlock[]
    expect(block[0]).toMatchObject({ type: 'tool_result', isError: true })
  })

  it('the tool result is bounded no matter how much code matches', async () => {
    const dir = join(root, 'src/big')
    mkdirSync(dir, { recursive: true })
    for (let i = 0; i < 30; i++) writeFileSync(join(dir, `m${i}.ts`), `export function zzbulk${i}() {\n${Array.from({ length: 60 }, (_, j) => `  // zzbulk filler line ${j} ${'x'.repeat(50)}`).join('\n')}\n}\n`)
    try {
      const { ctx } = await boot({ provider: 'none' })
      const r = await ctx.tools.call(SEARCH_TOOL, { query: 'zzbulk filler', k: 20 }, { sessionId: 's' })
      expect(r.ok).toBe(true)
      expect(r.content.length).toBeLessThanOrEqual(12_000)
      expect(r.content).toMatch(/more results? not shown/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/* ---------------------------------------- opt-in: a real local chat model */

const CHAT = process.env['HARNESS_OLLAMA_CHAT_MODEL']

describe.skipIf(!CHAT || !hasRg)(`real chat model (${CHAT}) driving the same pipeline`, () => {
  it('searches the project with the tool and answers with the real value', async () => {
    const chat = new OllamaProvider({ model: CHAT as string, timeoutMs: 600_000 })
    const { ctx } = await boot({ chat })
    const res = await ctx.agentLoop.run({
      sessionId: 's',
      prompt: `${Q_RETRIES} Use the search_code tool to look at the project's code first, and quote the exact number you find.`,
      system: 'You answer questions about a software project. You have a search_code tool. Never guess numbers: search first, then answer from the code you were shown.',
    })
    const calls = (await ctx.log.read('s')).filter((e) => e.type === 'tool.call')
    console.log(`real model: ${res.steps} steps, ${calls.length} search call(s)\nanswer: ${res.finalText}`)
    expect(calls.length, 'the model never used the search tool (does this model support tool calling?)').toBeGreaterThan(0)
    expect(res.finalText).toContain(RETRIES)
  })
})
