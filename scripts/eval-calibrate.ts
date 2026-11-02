/**
 * Phase 6.2 on REAL data: score real session logs and check the scorers against YOUR judgment of those runs.
 *
 *   npx tsx scripts/eval-calibrate.ts <logDir>                    print a report for every session in the folder
 *   npx tsx scripts/eval-calibrate.ts <logDir> labels.json        ... and measure agreement with your labels
 *   npx tsx scripts/eval-calibrate.ts <logDir> labels.json "^npm test"   also require a matching command to have passed
 *
 * <logDir> is a JSONL session-log folder (the `path` given to SessionLog). labels.json is
 *   { "<sessionId>": "good", "<other sessionId>": "bad" }
 * where "good" means you would accept that run's outcome. Label BEFORE you look at the scores, or the
 * measurement is worthless. Exit code 1 if agreement is below 90% (the acceptable floor in docs/phases.md 6.2).
 * Sessions without a label are reported but not counted. Nothing is sent anywhere; it only reads files.
 */
import { Context } from 'cordis'
import { readFileSync } from 'node:fs'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { EvalRunner, commandPassed, defaultScorers } from '../src/bundles/eval-runner/index.js'

const [dir, labelsFile, checkPattern] = process.argv.slice(2)
if (!dir) {
  console.error('usage: npx tsx scripts/eval-calibrate.ts <logDir> [labels.json] [checkCommandRegex]')
  process.exit(2)
}

const labels: Record<string, string> = labelsFile ? JSON.parse(readFileSync(labelsFile, 'utf8')) : {}
for (const [id, l] of Object.entries(labels)) if (l !== 'good' && l !== 'bad') { console.error(`label for ${id} must be "good" or "bad", got ${JSON.stringify(l)}`); process.exit(2) }

const ctx = new Context()
await ctx.plugin(SessionLog, { path: dir })
await ctx.plugin(EvalRunner, { scorers: [...defaultScorers(), ...(checkPattern ? [commandPassed({ name: 'checks-pass', pattern: new RegExp(checkPattern), requireRun: true })] : [])] })

const ids = await ctx.log.list()
if (ids.length === 0) { console.error(`no sessions found in ${dir}`); process.exit(2) }

let counted = 0
let agree = 0
const disagreements: string[] = []
for (const id of ids.sort()) {
  const r = await ctx.eval.score(id)
  const label = labels[id]
  const verdict = r.passed ? 'PASS' : 'FAIL'
  console.log(`\n${id}  ${verdict}  score ${r.score.toFixed(2)}  (${r.eventCount} events)${label ? `  your label: ${label}` : ''}`)
  for (const x of r.results) console.log(`  ${x.applicable ? (x.pass ? 'ok  ' : 'FAIL') : 'n/a '} ${x.name}${x.required ? '*' : ''}: ${x.detail}`)
  if (label) {
    counted++
    if (r.passed === (label === 'good')) agree++
    else disagreements.push(`${id}: scorer says ${verdict}, you said ${label}`)
  }
}
console.log('\n* = required scorer')
if (counted) {
  const rate = agree / counted
  console.log(`\nagreement with your labels: ${agree}/${counted} (${Math.round(rate * 100)}%)`)
  for (const d of disagreements) console.log(`  DISAGREE ${d}`)
  if (counted < 10) console.log(`  note: ${counted} labelled runs is too few to trust a percentage; aim for 20 or more, with both good and bad.`)
  process.exit(rate >= 0.9 ? 0 : 1)
}
