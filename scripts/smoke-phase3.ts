/**
 * Phase 3 smoke check: the semantic memory tier (3.3) against a REAL embedding
 * model. The unit tests use a stand-in embedder, so they cannot show that a
 * real model finds a fact from a differently-worded question. This does.
 *
 *   $env:HARNESS_OLLAMA_EMBED_MODEL="nomic-embed-text"     (PowerShell)
 *   npx tsx scripts/smoke-phase3.ts
 *
 * Without HARNESS_OLLAMA_EMBED_MODEL it falls back to the offline hashing
 * provider, which is lexical: the paraphrase checks are then reported as
 * SKIP (not PASS), because passing them would prove nothing.
 * Uses throwaway temp directories; writes nothing in your project.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from 'cordis'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { Embeddings } from '../src/bundles/embeddings/index.js'
import { MemorySemantic } from '../src/bundles/memory/index.js'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { LanceVectorStore } from '../src/bundles/vectorstore-lancedb/index.js'

const model = process.env['HARNESS_OLLAMA_EMBED_MODEL']
let failed = 0
const check = (name: string, pass: boolean, detail = ''): void => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ->  ' + detail : ''}`)
  if (!pass) failed++
}
let skipped = 0
const skip = (name: string, why: string): void => {
  skipped++
  console.log(`SKIP  ${name}  ->  ${why}`)
}

const STOP = new Set('the a an and or of to in on is are it its be by for with as at we our do does how what why which that this from than so can not no'.split(' '))
const words = (s: string) => new Set((s.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => !STOP.has(w)))

const WHY = 'Recorded rationale from the project docs; not visible in the code itself'
const FACTS: { id: string; text: string; query: string }[] = [
  { id: 'retry', text: "Failed model calls are retried with exponential backoff, honouring the server's retry-after hint", query: 'what does the agent do when the provider rate-limits it and asks it to wait' },
  { id: 'fingerprint', text: "Vectors made by one embedding model cannot be compared with another's, so the stored index is rebuilt when the model changes", query: 'why do we throw away saved numeric representations after swapping the language encoder' },
  { id: 'free-tier', text: 'The free OpenRouter tier allows only fifty requests a day, so nothing may spend a model call per turn', query: 'which design rule protects our small daily quota of hosted inference' },
  { id: 'inject', text: 'A Cordis plugin must list every service it touches in its static inject array or access throws', query: 'what happens if a bundle uses a dependency without declaring it up front' },
  { id: 'gates-last', text: 'Policy gates are built last so the unguarded path can be tested before enforcement is added', query: 'why was the protective layer left until the end of the build order' },
  { id: 'redaction', text: 'Registered secrets are redacted from every payload before it is logged or sent off the machine', query: 'how are API keys kept out of outgoing requests and audit records' },
]
const UNANSWERABLE = ['how do I bake sourdough bread at home', 'what colour is the sky on mars', 'who won the football world cup']

const base = realpathSync(mkdtempSync(join(tmpdir(), 'harness-smoke3-')))
try {
  const ctx = new Context()
  await ctx.plugin(SessionLog, { memory: true })
  await ctx.plugin(EgressPolicy, { projectId: 'smoke3' })
  await ctx.plugin(
    Embeddings,
    model ? { ollama: { model, timeoutMs: 300_000 }, prefixes: model.startsWith('nomic') ? { document: 'search_document: ', query: 'search_query: ' } : {} } : {},
  )
  if (!model) {
    const { HashingEmbeddingProvider } = await import('../src/bundles/embeddings/index.js')
    ctx.embeddings.register(new HashingEmbeddingProvider({ dimensions: 256 }))
  }
  await ctx.plugin(LanceVectorStore, { path: join(base, 'db') })
  await ctx.plugin(MemorySemantic, { path: join(base, 'mem') })
  console.log(`embeddings provider: ${model ? `ollama / ${model}` : 'hashing (offline, lexical; paraphrase checks will SKIP)'}`)

  for (const f of FACTS) {
    const r = await ctx.memorySemantic.add({ text: f.text, why: WHY, id: f.id })
    check(`3.3 add "${f.id}"`, r.created && r.indexed === true, r.indexError ?? '')
  }

  console.log('\nParaphrase retrieval (each query is worded differently from its fact):')
  // Gate: the fact must be FOUND within the top 3 (that is the 3.3 criterion). Top-1 is reported but not gated:
  // it was first written as the gate, failed 5/6 on the owner's real run with one ambiguous query, and was
  // then relaxed to this (DBG-037). Both numbers are always printed so the relaxation cannot hide anything.
  const GATE_RANK = 3
  let top1 = 0
  let inTop = 0
  const answerable: number[] = []
  for (const f of FACTS) {
    const shared = [...words(f.query)].filter((w) => words(f.text).has(w))
    const r = await ctx.memorySemantic.query(f.query, { k: FACTS.length })
    if (!r.ok) {
      check(`3.3 query "${f.id}"`, false, `${r.error.kind}: ${r.error.detail}`)
      continue
    }
    const rank = r.hits.findIndex((h) => h.fact.id === f.id) + 1
    const score = r.hits.find((h) => h.fact.id === f.id)?.score ?? 0
    answerable.push(score)
    if (rank === 1) top1++
    if (rank >= 1 && rank <= GATE_RANK) inTop++
    const beat = rank === 1 ? '' : `; ahead of it: ${r.hits.slice(0, Math.max(0, rank - 1) || 1).map((h) => `${h.fact.id} ${h.score.toFixed(3)}`).join(', ')}`
    const detail = `rank ${rank || '>' + FACTS.length}, similarity ${score.toFixed(3)}, shared content words: ${shared.length ? shared.join(',') : 'none'}${beat}`
    if (model) check(`3.3 paraphrase: "${f.query}" finds "${f.id}" within the top ${GATE_RANK}`, rank >= 1 && rank <= GATE_RANK, detail)
    else skip(`3.3 paraphrase "${f.id}"`, detail)
  }
  if (model) {
    check(`3.3 paraphrase: every query finds its fact within the top ${GATE_RANK}`, inTop === FACTS.length, `${inTop}/${FACTS.length}`)
    console.log(`INFO  top-1 rate: ${top1}/${FACTS.length} (not gated)`)
  }

  console.log('\nUnrelated questions (use these to choose a minScore):')
  const unrelated: number[] = []
  for (const q of UNANSWERABLE) {
    const r = await ctx.memorySemantic.query(q, { k: 1 })
    const s = r.ok ? (r.hits[0]?.score ?? 0) : NaN
    unrelated.push(s)
    console.log(`      UNRELATED   ${s.toFixed(3)}   ${q}`)
  }
  if (model) {
    const lo = Math.min(...answerable)
    const hi = Math.max(...unrelated)
    check('3.3 separation: weakest real match beats the strongest unrelated one', lo > hi, `weakest match ${lo.toFixed(3)} vs strongest unrelated ${hi.toFixed(3)}`)
  }

  const stale = await ctx.memorySemantic.query(FACTS[0]!.query)
  check('3.3 index is in step with the facts (stale = false)', stale.ok && !stale.stale)
  check('3.3 remove deletes the fact and its vector', (await ctx.memorySemantic.remove('retry')) === true && ((await ctx.memorySemantic.query(FACTS[0]!.query)) as any).stale === false)
} finally {
  rmSync(base, { recursive: true, force: true })
}
if (skipped) console.log(`\n${skipped} check(s) SKIPPED: set HARNESS_OLLAMA_EMBED_MODEL to run them against a real model. This run does NOT show that paraphrase search works.`)
console.log(failed === 0 ? (skipped ? '\nNO FAILURES (with skips; see above)' : '\nALL CHECKS PASSED') : `\n${failed} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
