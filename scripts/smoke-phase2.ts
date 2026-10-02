/**
 * Phase 2 smoke check: runs retrieval-grep (2.1), retrieval-treesitter (2.2),
 * embeddings (2.3), the LanceDB vector store (2.4), the ranker (2.5) and the agent loop (2.6) for real on this machine and prints PASS/FAIL per check.
 *
 *   npx tsx scripts/smoke-phase2.ts                     # searches the current directory
 *   npx tsx scripts/smoke-phase2.ts <project-dir>
 *
 * Embeddings use local Ollama when HARNESS_OLLAMA_EMBED_MODEL is set
 * (e.g. nomic-embed-text), otherwise the offline hashing provider. Set HARNESS_OLLAMA_CHAT_MODEL
 * (a chat model that supports tools) to also let a real model drive the 2.6 agent run.
 * Uses a throwaway temp directory for the secret/path checks; writes nothing in your project.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from 'cordis'
import { AgentLoop } from '../src/bundles/agent-loop/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { LLMService, MockProvider, OllamaProvider, type ProviderRequest } from '../src/bundles/model-adapter/index.js'
import { SEARCH_TOOL, RetrievalTools } from '../src/bundles/retrieval-tools/index.js'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { ToolRegistry } from '../src/bundles/tool-registry/index.js'
import { Embeddings, HashingEmbeddingProvider } from '../src/bundles/embeddings/index.js'
import { RetrievalGrep } from '../src/bundles/retrieval-grep/index.js'
import { RetrievalRank } from '../src/bundles/retrieval-rank/index.js'
import { RetrievalTreesitter } from '../src/bundles/retrieval-treesitter/index.js'
import { Subprocess } from '../src/bundles/subprocess/index.js'
import { LanceVectorStore } from '../src/bundles/vectorstore-lancedb/index.js'

const project = resolve(process.argv[2] ?? process.cwd())
const model = process.env['HARNESS_OLLAMA_EMBED_MODEL']
const chatModel = process.env['HARNESS_OLLAMA_CHAT_MODEL']
let failed = 0
const check = (name: string, pass: boolean, detail = ''): void => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ->  ' + detail : ''}`)
  if (!pass) failed++
}
const cosine = (a: Float32Array, b: Float32Array): number => a.reduce((s, x, i) => s + x * (b[i] as number), 0) / (Math.hypot(...a) * Math.hypot(...b))

console.log(`project: ${project}`)
console.log(`node ${process.version} on ${process.platform}\n`)

/* ---- 2.1 retrieval-grep ---- */
const ctx = new Context()
await ctx.plugin(Subprocess)
await ctx.plugin(RetrievalGrep, { root: project })
const found = await ctx.retrievalGrep.search('registerSecret', { fixedStrings: true })
if (!found.ok) {
  check('2.1 grep: ripgrep runs', false, `${found.error.kind}${found.error.detail ? ': ' + found.error.detail : ''}` + (found.error.kind === 'rg_missing' ? '  (install ripgrep and open a NEW terminal so it is on PATH)' : ''))
} else {
  check('2.1 grep: finds a known symbol in this project', found.results.length > 0, `${found.results.length} file(s): ${found.results.slice(0, 3).map((r) => `${r.file} (${r.matchCount})`).join(', ')}`)
}

const base = realpathSync(mkdtempSync(join(tmpdir(), 'harness-smoke-')))
try {
  const root = join(base, 'root')
  mkdirSync(join(base, 'root-evil'), { recursive: true })
  mkdirSync(root, { recursive: true })
  const TOKEN = 'smoke-token-7431'
  writeFileSync(join(root, 'ordinary.txt'), `${TOKEN}\n`)
  writeFileSync(join(root, '.env'), `${TOKEN}\n`)
  writeFileSync(join(root, 'prod.pem'), `${TOKEN}\n`)
  writeFileSync(join(base, 'root-evil', 'loot.txt'), `${TOKEN}\n`)
  const c2 = new Context()
  await c2.plugin(Subprocess)
  await c2.plugin(RetrievalGrep, { root })
  const r = await c2.retrievalGrep.search(TOKEN)
  const names = r.ok ? r.results.map((x) => x.file).sort() : []
  check('2.1 grep: secrets (.env, .pem) are not returned, ordinary files are', r.ok && names.join(',') === 'ordinary.txt', r.ok ? `returned: ${names.join(', ') || '(none)'}` : r.error.kind)
  for (const path of ['..', '../root-evil', base]) {
    const o = await c2.retrievalGrep.search(TOKEN, { path })
    check(`2.1 grep: path "${path === base ? '<parent dir>' : path}" is refused`, !o.ok && o.error.kind === 'outside_root', o.ok ? 'it searched outside the root!' : o.error.kind)
  }
} finally {
  rmSync(base, { recursive: true, force: true })
}

/* ---- 2.2 retrieval-treesitter ---- */
const c3 = new Context()
await c3.plugin(RetrievalTreesitter)
const target = 'src/bundles/retrieval-grep/index.ts'
try {
  const parsed = await c3.retrievalParse.parse(readFileSync(join(project, target), 'utf8'), { filename: target })
  if (!parsed.ok) check('2.2 parse: TypeScript file', false, parsed.error.kind + (parsed.error.detail ? ': ' + parsed.error.detail : ''))
  else {
    const names = parsed.file.symbols.map((s) => s.qualifiedName)
    check('2.2 parse: finds the RetrievalGrep class and its search method', names.includes('RetrievalGrep') && names.includes('RetrievalGrep.search'), `${parsed.file.symbols.length} symbols, errors=${parsed.file.hasErrors}: ${names.slice(0, 4).join(', ')}...`)
  }
  const py = await c3.retrievalParse.parse('class A:\n    def m(self):\n        pass\n', { language: 'python' })
  check('2.2 parse: Python grammar loads', py.ok && py.file.symbols.map((s) => s.qualifiedName).join() === 'A,A.m')
} catch (e: any) {
  check('2.2 parse: read the target file', false, e?.message ?? String(e))
}

/* ---- 2.3 embeddings ---- */
const c4 = new Context()
await c4.plugin(Embeddings, model ? { ollama: { model, timeoutMs: 300_000 }, prefixes: model.startsWith('nomic') ? { document: 'search_document: ', query: 'search_query: ' } : {} } : {})
if (!model) c4.embeddings.register(new HashingEmbeddingProvider({ dimensions: 256 }))
console.log(`\nembeddings provider: ${model ? `ollama / ${model}` : 'hashing (offline stand-in; set HARNESS_OLLAMA_EMBED_MODEL to test the real thing)'}`)
const texts = ['sorts a list of numbers in ascending order', 'orders an array from smallest to largest', 'how to bake sourdough bread at home', 'sorts a list of numbers in ascending order']
const e1 = await c4.embeddings.embed(texts)
if (!e1.ok) {
  check('2.3 embeddings: embed a batch', false, `${e1.error.kind}: ${e1.error.detail}`)
} else {
  check('2.3 embeddings: 4 texts (3 distinct) = 1 provider call', e1.requests === 1 && e1.unique === 3 && e1.vectors.length === 4, `requests=${e1.requests} unique=${e1.unique} dims=${e1.dimensions}`)
  const e2 = await c4.embeddings.embed([texts[0] as string])
  check('2.3 embeddings: same text twice gives the same vector', e2.ok && cosine(e2.vectors[0] as Float32Array, e1.vectors[0] as Float32Array) > 0.9999)
  const [a, b, c] = e1.vectors as [Float32Array, Float32Array, Float32Array]
  console.log(`      similarity: paraphrase ${cosine(a, b).toFixed(3)}   unrelated ${cosine(a, c).toFixed(3)}${model ? '' : '   (hashing has no semantics: only shared words count, so both are ~0 here)'}`)
  if (model) check('2.3 embeddings: a paraphrase is closer than an unrelated text', cosine(a, b) > cosine(a, c))
  console.log(`      fingerprint: ${c4.embeddings.info()?.fingerprint}`)
}


/* ---- 2.4 vectorstore-lancedb: parse -> embed -> store -> query, restart, fingerprint ---- */
const vsBase = realpathSync(mkdtempSync(join(tmpdir(), 'harness-smoke-vs-')))
try {
  const fp = c4.embeddings.info()?.fingerprint
  const dims = c4.embeddings.info()?.dimensions
  const src = readFileSync(join(project, target), 'utf8')
  const parsed = await c3.retrievalParse.parse(src, { filename: target })
  if (!fp || !dims || !parsed.ok) throw new Error('needs the embeddings and parse steps above to have worked')
  const syms = parsed.file.symbols
  const emb = await c4.embeddings.embed(syms.map((x) => x.signature))
  if (!emb.ok) throw new Error(`embeddings: ${emb.error.kind}: ${emb.error.detail}`)
  const dbPath = join(vsBase, 'db')
  const idOf = (i: number) => `${target}#${syms[i]!.qualifiedName}@${syms[i]!.startLine}`

  const c5 = new Context()
  const fiber = await c5.plugin(LanceVectorStore, { path: dbPath })
  const opened = await c5.vectorstore.open('smoke', { fingerprint: fp, dimensions: dims })
  if (!opened.ok) {
    check('2.4 vectorstore: native LanceDB loads and a collection opens', false, `${opened.error.kind}: ${opened.error.detail}`)
  } else {
    const col = opened.collection
    check('2.4 vectorstore: native LanceDB loads and a collection opens', true, `${process.platform}, ${dims} dims, fingerprint ${fp}`)
    const up = await col.upsert(syms.map((x, i) => ({ id: idOf(i), vector: emb.vectors[i] as Float32Array, source: target, metadata: { symbol: x.qualifiedName, startLine: x.startLine, endLine: x.endLine } })))
    check('2.4 vectorstore: stores every symbol of a real file', up.ok && up.written === syms.length, up.ok ? `${up.written} symbols` : up.error.detail)
    const sigs = new Map(syms.map((x, i) => [idOf(i), x.signature]))
    let selfOk = 0
    for (let i = 0; i < syms.length; i++) {
      const q = await col.query(emb.vectors[i] as Float32Array, 1)
      const top = q.ok ? q.hits[0] : undefined
      if (top && top.score > 0.9999 && (top.id === idOf(i) || sigs.get(top.id) === syms[i]!.signature)) selfOk++
    }
    check('2.4 vectorstore: each symbol retrieves itself as the top hit', selfOk === syms.length, `${selfOk}/${syms.length}`)
    const scoped = await col.query(emb.vectors[0] as Float32Array, 3, { source: target })
    check('2.4 vectorstore: query restricted to a source works, metadata comes back', scoped.ok && scoped.hits.length > 0 && typeof scoped.hits[0]?.metadata?.['symbol'] === 'string', scoped.ok ? `top: ${scoped.hits[0]?.metadata?.['symbol']}` : scoped.error.detail)

    await fiber.dispose() // "restart"
    const c6 = new Context()
    await c6.plugin(LanceVectorStore, { path: dbPath })
    const again = await c6.vectorstore.open('smoke', { fingerprint: fp, dimensions: dims })
    const n = again.ok ? await again.collection.count() : undefined
    check('2.4 vectorstore: data is still there after a restart', !!n && n.ok && n.count === syms.length, n?.ok ? `${n.count} records` : 'reopen failed')
    const wrong = await c6.vectorstore.open('smoke', { fingerprint: fp + ':other-model', dimensions: dims })
    check('2.4 vectorstore: a different embedding model is refused (vectors are not comparable)', !wrong.ok && wrong.error.kind === 'fingerprint_mismatch', wrong.ok ? 'it opened!' : wrong.error.kind)
    if (again.ok) {
      const del = await again.collection.deleteSource(target)
      const left = await again.collection.count()
      check('2.4 vectorstore: deleting a source removes all its records', del.ok && del.deleted === syms.length && left.ok && left.count === 0, del.ok ? `deleted ${del.deleted}` : del.error.detail)
    }
  }
} catch (e: any) {
  check('2.4 vectorstore: pipeline', false, e?.message ?? String(e))
} finally {
  rmSync(vsBase, { recursive: true, force: true })
}


/* ---- 2.5 retrieval-rank: index this project, then rank real questions ---- */
// The index lives in a fixed folder (one per embedding model) and is kept between runs: re-indexing unchanged
// files costs nothing, so only your FIRST run with a real model is slow (about 6 minutes for src/ on a laptop CPU).
const rankBase = join(tmpdir(), 'harness-smoke-index', (model ?? 'hashing').replace(/[^A-Za-z0-9_.-]/g, '_'))
try {
  const c7 = new Context()
  await c7.plugin(Subprocess)
  await c7.plugin(RetrievalGrep, { root: project })
  await c7.plugin(RetrievalTreesitter)
  await c7.plugin(Embeddings, model ? { ollama: { model, timeoutMs: 300_000 }, prefixes: model.startsWith('nomic') ? { document: 'search_document: ', query: 'search_query: ' } : {} } : {})
  if (!model) c7.embeddings.register(new HashingEmbeddingProvider({ dimensions: 256 }))
  await c7.plugin(LanceVectorStore, { path: join(rankBase, 'db') })
  await c7.plugin(RetrievalRank, { root: project })
  const rank = c7.retrievalRank
  // the Phase 1 agent stack, so the same context can run an agent over the retrieval tools (2.6)
  await c7.plugin(SessionLog, { memory: true })
  await c7.plugin(EgressPolicy, { projectId: 'smoke' })
  await c7.plugin(ToolRegistry)
  await c7.plugin(LLMService, {})
  await c7.plugin(RetrievalTools, {})
  await c7.plugin(AgentLoop, { maxSteps: 8 })

  const t0 = Date.now()
  let lastShown = -1
  const idx = await rank.indexProject({
    path: 'src',
    onProgress: (done, total) => {
      const pct = Math.floor((done / Math.max(total, 1)) * 100)
      if (pct !== lastShown && (pct % 10 === 0 || done === total)) {
        lastShown = pct
        console.log(`      indexing: ${done}/${total} chunks (${pct}%), ${((Date.now() - t0) / 1000).toFixed(0)}s`)
      }
    },
  })
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  if (!idx.ok) check('2.5 rank: index the src/ directory', false, `${idx.error.kind}: ${idx.error.detail}`)
  else {
    check('2.5 rank: index the src/ directory', idx.files > 10 && idx.chunks > idx.files, `${idx.files} files -> ${idx.chunks} chunks in ${secs}s: ${idx.embeddedChunks} embedded now, ${idx.reusedChunks} reused from the saved index (${idx.skipped.length} skipped)`)
    const questions: Array<[string, string]> = [
      ['ripgrep search confined to a root directory', 'retrieval-grep'],
      ['parse source code into function and class symbols with tree-sitter', 'retrieval-treesitter'],
      ['store vectors and find the nearest by cosine similarity', 'vectorstore-lancedb'],
      ['turn text into embeddings in batches with ollama', 'embeddings'],
    ]
    for (const [q, dir] of questions) {
      const rows: string[] = []
      let lexTop5 = false
      for (const w of [0, 0.5, 1]) {
        const r = await rank.search(q, { k: 5, path: 'src', weight: w })
        if (!r.ok) {
          check(`2.5 rank: "${q}" (weight ${w})`, false, `${r.error.kind}: ${r.error.detail}`)
          continue
        }
        const top = r.hits.map((h) => `${h.file.replace('src/bundles/', '')}${h.name ? '::' + h.name : ''}`)
        rows.push(`      w=${w}${r.mode === 'bm25' && w > 0 ? ' (lexical only: ' + (r.degraded ?? '') + ')' : ''}: ${top.slice(0, 3).join('  |  ')}`)
        if (w === 0) lexTop5 = r.hits.some((h) => h.file.includes(dir))
      }
      check(`2.5 rank: "${q}" finds ${dir} in the top 5 (lexical)`, lexTop5)
      for (const row of rows) console.log(row)
    }
    const hybrid = await rank.search('turn text into embeddings in batches with ollama', { k: 5, path: 'src', weight: 0.5 })
    const t1 = Date.now()
    const again = await rank.indexProject({ path: 'src' })
    check('2.5 rank: re-indexing unchanged files embeds nothing (incremental)', again.ok && again.embeddedChunks === 0 && again.reusedChunks === again.chunks, again.ok ? `${again.embeddedChunks} embedded, ${again.reusedChunks} reused, ${((Date.now() - t1) / 1000).toFixed(1)}s` : again.error.detail)
    check('2.5 rank: hybrid search uses the vector index', hybrid.ok && hybrid.mode === 'hybrid' && hybrid.hits.some((h) => h.vectorRank !== undefined), hybrid.ok ? `mode=${hybrid.mode}, stale=${hybrid.stats.staleVectorHits}` : hybrid.error.detail)

    /* ---- 2.6: an agent answers from retrieved code ---- */
    const askScripted = async (question: string) => {
      const model = new MockProvider((req: ProviderRequest) => {
        const results = req.messages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result').map((b) => (b as { content: string }).content) : []))
        if (results.length === 0) {
          const first = req.messages[0]
          const words = [...new Set(((typeof first?.content === 'string' ? first.content : '').toLowerCase().match(/[a-z]{5,}/g) ?? []))].slice(0, 6).join(' ')
          return { toolCalls: [{ id: 'c1', name: SEARCH_TOOL, input: { query: words } }], content: [{ type: 'tool_use' as const, id: 'c1', name: SEARCH_TOOL, input: { query: words } }] }
        }
        const m = results[0]!.match(/<<<CODE \w+ #1 (\S+):(\d+)-(\d+)/)
        return { text: m ? `Top result: ${m[1]} lines ${m[2]}-${m[3]}` : 'Nothing found.' }
      })
      const off = c7.llm.register('scripted', model, { default: true })
      try {
        return await c7.agentLoop.run({ sessionId: 'smoke-scripted', prompt: question, provider: 'scripted' })
      } finally {
        off()
      }
    }
    for (const [q, dir] of questions.slice(0, 2)) {
      try {
        const run = await askScripted(q)
        check(`2.6 agent: "${q}" is answered from retrieved code (scripted model)`, run.stopReason === 'done' && run.steps === 2 && run.finalText.includes(dir), run.finalText)
      } catch (e: any) {
        check(`2.6 agent: "${q}"`, false, e?.message ?? String(e))
      }
    }
    const events = await c7.log.read('smoke-scripted')
    check('2.6 agent: the search tool call and its result are both in the session log', events.some((e) => e.type === 'tool.call') && events.some((e) => e.type === 'tool.result'), events.map((e) => e.type).join(' '))

    // Calibration data for `minVectorScore`: how similar are the nearest chunks for answerable vs unanswerable questions?
    console.log('\n      similarity of the best vector match (use this to pick a minVectorScore between the two groups):')
    const probes: Array<[string, string]> = [...questions.map(([q]) => [q, 'answerable'] as [string, string]), ['how do I bake sourdough bread at home', 'UNANSWERABLE'], ['what colour is the sky on mars', 'UNANSWERABLE']]
    for (const [q, kind] of probes) {
      const r = await rank.search(q, { k: 5, path: 'src', weight: 1 })
      const best = r.ok ? r.hits.find((h) => h.vectorScore !== undefined)?.vectorScore : undefined
      console.log(`      ${kind.padEnd(12)} ${best === undefined ? '  n/a' : best.toFixed(3)}   ${q}`)
    }

    if (model) {
      const FLOOR = 0.6 // chosen from the table above (D-060): between the unanswerable (<= 0.52) and answerable (>= 0.70) groups
      let keeps = 0
      let drops = 0
      for (const [q] of questions) {
        const r = await rank.search(q, { k: 5, path: 'src', weight: 1, minVectorScore: FLOOR })
        if (r.ok && r.hits.length > 0) keeps++
      }
      for (const q of ['how do I bake sourdough bread at home', 'what colour is the sky on mars']) {
        const r = await rank.search(q, { k: 5, path: 'src', weight: 1, minVectorScore: FLOOR })
        if (r.ok && r.hits.length === 0) drops++
      }
      check(`2.5 rank: a ${FLOOR} similarity floor keeps all ${questions.length} answerable questions and drops both unanswerable ones`, keeps === questions.length && drops === 2, `kept ${keeps}/${questions.length}, dropped ${drops}/2`)
    }

    if (chatModel) {
      try {
        c7.llm.register('chat', new OllamaProvider({ model: chatModel, timeoutMs: 600_000 }), { default: true })
        const run = await c7.agentLoop.run({
          sessionId: 'smoke-real',
          prompt: "In this project, which function parses ripgrep's JSON output into per-file results, and how does it treat paths that are not valid UTF-8? Use the search_code tool first.",
          provider: 'chat',
          system: 'You answer questions about a software project. You have a search_code tool. Never guess: search first, then answer only from the code you were shown.',
        })
        const calls = (await c7.log.read('smoke-real')).filter((e) => e.type === 'tool.call').length
        console.log(`\n      real model ${chatModel}: ${run.steps} steps, ${calls} search call(s)\n      answer: ${run.finalText.replace(/\s+/g, ' ').slice(0, 400)}`)
        check(`2.6 agent: real model ${chatModel} used the search tool`, calls > 0, calls === 0 ? 'it never called search_code (does this model support tool calling?)' : `${calls} call(s); judge the answer above yourself`)
      } catch (e: any) {
        check(`2.6 agent: real model ${chatModel}`, false, e?.message ?? String(e))
      }
    }
  }
} catch (e: any) {
  check('2.5 rank: pipeline', false, e?.message ?? String(e))
} finally {
  console.log(`\n(the saved index in ${rankBase} makes the next run fast; delete that folder to start over)`)
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
