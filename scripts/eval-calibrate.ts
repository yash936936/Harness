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
 * measurement is worthless. Exit code 1 if fewer than 20 real sessions are labelled, either class is
 * absent, or agreement is below 90%. Labels for session IDs absent from the log directory are rejected.
 * Sessions without a label are reported but not counted. Nothing is sent anywhere; it only reads files.
 */
import { Context } from 'cordis'
import { readFileSync, writeFileSync } from 'node:fs'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { EvalRunner, commandPassed, defaultScorers } from '../src/bundles/eval-runner/index.js'

const [dir, labelsFile, checkPattern] = process.argv.slice(2)
const MIN_LABELS = 20
if (!dir) {
  console.error('usage: npx tsx scripts/eval-calibrate.ts <logDir> [labels.json] [checkCommandRegex]')
  process.exit(2)
}

let labels: Record<string, 'good' | 'bad'> = {}
if (labelsFile) {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(labelsFile, 'utf8'))
  } catch (error) {
    console.error(`could not read labels file ${labelsFile}: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error('labels.json must be an object mapping session IDs to "good" or "bad"')
    process.exit(2)
  }
  labels = parsed as Record<string, 'good' | 'bad'>
  for (const [id, label] of Object.entries(labels)) {
    if (!id.trim() || (label !== 'good' && label !== 'bad')) {
      console.error(`label for ${JSON.stringify(id)} must be "good" or "bad", got ${JSON.stringify(label)}`)
      process.exit(2)
    }
  }
}

let extraScorers
if (checkPattern) {
  try {
    extraScorers = [commandPassed({ name: 'checks-pass', pattern: new RegExp(checkPattern), requireRun: true })]
  } catch (error) {
    console.error(`invalid check command regex: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }
}

const ctx = new Context()
await ctx.plugin(SessionLog, { path: dir })
await ctx.plugin(EvalRunner, { scorers: [...defaultScorers(), ...(extraScorers ?? [])] })

const ids = await ctx.log.list()
if (ids.length === 0) {
  console.error(`no sessions found in ${dir}`)
  process.exit(2)
}

const availableIds = new Set(ids)
const unknownLabelIds = Object.keys(labels).filter((id) => !availableIds.has(id))
if (unknownLabelIds.length > 0) {
  console.error(`labels reference ${unknownLabelIds.length} session ID(s) not present in ${dir}:`)
  for (const id of unknownLabelIds) console.error(`  ${id}`)
  process.exit(2)
}

let counted = 0
let agree = 0
const classCounts = { good: 0, bad: 0 }
const report: Array<{ sessionId: string; scorer: 'good' | 'bad'; label?: 'good' | 'bad'; score: number; eventCount: number }> = []
const disagreements: string[] = []
for (const id of ids.sort()) {
  const r = await ctx.eval.score(id)
  const label = labels[id]
  const scorer = r.passed ? 'good' : 'bad'
  const verdict = r.passed ? 'PASS' : 'FAIL'
  console.log(`\n${id}  ${verdict}  score ${r.score.toFixed(2)}  (${r.eventCount} events)${label ? `  your label: ${label}` : ''}`)
  for (const x of r.results) console.log(`  ${x.applicable ? (x.pass ? 'ok  ' : 'FAIL') : 'n/a '} ${x.name}${x.required ? '*' : ''}: ${x.detail}`)
  report.push({ sessionId: id, scorer, ...(label ? { label } : {}), score: r.score, eventCount: r.eventCount })
  if (label) {
    counted++
    classCounts[label]++
    if (scorer === label) agree++
    else disagreements.push(`${id}: scorer says ${verdict}, you said ${label}`)
  }
}

console.log('\n* = required scorer')
if (labelsFile) {
  const rate = counted === 0 ? 0 : agree / counted
  const hasBothClasses = classCounts.good > 0 && classCounts.bad > 0
  const calibrated = counted >= MIN_LABELS && hasBothClasses
  writeFileSync('calibration-report.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    logDirectory: dir,
    labelsFile,
    checkPattern: checkPattern ?? null,
    minimumIndependentLabels: MIN_LABELS,
    labelledCount: counted,
    classCounts,
    agreement: { correct: agree, total: counted, rate },
    sessions: report,
  }, null, 2) + '\n')
  console.log(`\nreport: calibration-report.json; minimum ${MIN_LABELS} labels with both classes: ${calibrated ? 'met' : 'NOT MET'}`)
  console.log(`\nagreement with your labels: ${agree}/${counted} (${Math.round(rate * 100)}%)`)
  for (const d of disagreements) console.log(`  DISAGREE ${d}`)
  process.exit(calibrated && rate >= 0.9 ? 0 : 1)
}
