/**
 * Phase 2 smoke check: runs retrieval-grep (2.1), retrieval-treesitter (2.2),
 * embeddings (2.3) and the LanceDB vector store (2.4) for real on this machine and prints PASS/FAIL per check.
 *
 *   npx tsx scripts/smoke-phase2.ts                     # searches the current directory
 *   npx tsx scripts/smoke-phase2.ts <project-dir>
 *
 * Embeddings use local Ollama when HARNESS_OLLAMA_EMBED_MODEL is set
 * (e.g. nomic-embed-text), otherwise the offline hashing provider.
 * Uses a throwaway temp directory for the secret/path checks; writes nothing in your project.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from 'cordis'
import { Embeddings, HashingEmbeddingProvider } from '../src/bundles/embeddings/index.js'
import { RetrievalGrep } from '../src/bundles/retrieval-grep/index.js'
import { RetrievalTreesitter } from '../src/bundles/retrieval-treesitter/index.js'
import { Subprocess } from '../src/bundles/subprocess/index.js'
import { LanceVectorStore } from '../src/bundles/vectorstore-lancedb/index.js'

const project = resolve(process.argv[2] ?? process.cwd())
const model = process.env['HARNESS_OLLAMA_EMBED_MODEL']
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

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
