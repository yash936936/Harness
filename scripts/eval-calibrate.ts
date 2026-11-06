/**
 * Phase 6.2 on REAL data: compare scorer verdicts with independently assigned human labels.
 *
 * Usage:
 *   npx tsx scripts/eval-calibrate.ts <logDir> [labels.json] [checkCommandRegex]
 *
 * Commit and hash labels before scorer output is generated or viewed. Prototype-grade
 * evaluation requires at least 10 matched labels (20+ when already available) and both classes.
 * Agreement is reported with a confusion table; it is not a pass/fail gate.
 * Labels for session IDs absent from the log directory are rejected.
 */
import { Context } from 'cordis'
import { readFileSync, writeFileSync } from 'node:fs'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { EvalRunner, commandPassed, defaultScorers } from '../src/bundles/eval-runner/index.js'
import { meetsCalibrationMinimum, validateHumanRunLabels } from './eval-calibrate-validation.js'

const [dir, labelsFile, checkPattern] = process.argv.slice(2)
const MIN_LABELS = 10
if (!dir) {
  console.error('usage: npx tsx scripts/eval-calibrate.ts <logDir> [labels.json] [checkCommandRegex]')
  process.exit(2)
}

let parsedLabels: unknown = {}
if (labelsFile) {
  try {
    parsedLabels = JSON.parse(readFileSync(labelsFile, 'utf8'))
  } catch (error) {
    console.error(`could not read labels file ${labelsFile}: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }
}

let checkRegex: RegExp | undefined
if (checkPattern) {
  try {
    checkRegex = new RegExp(checkPattern)
  } catch (error) {
    console.error(`invalid check command regex: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }
}

const ctx = new Context()
await ctx.plugin(SessionLog, { path: dir })
await ctx.plugin(EvalRunner, {
  scorers: [...defaultScorers(), ...(checkRegex ? [commandPassed({ name: 'checks-pass', pattern: checkRegex, requireRun: true })] : [])],
})

const ids = await ctx.log.list()
if (ids.length === 0) {
  console.error(`no sessions found in ${dir}`)
  process.exit(2)
}

let labels: Record<string, 'good' | 'bad'> = {}
if (labelsFile) {
  try {
    const validated = validateHumanRunLabels(parsedLabels, ids)
    if (validated.unknownIds.length) {
      console.error(`labels reference sessions not present in log directory: ${validated.unknownIds.join(', ')}`)
      process.exit(2)
    }
    labels = validated.labels
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
}

let counted = 0
let agree = 0
const report: Array<{ sessionId: string; scorer: 'good' | 'bad'; label?: string; score: number; eventCount: number }> = []
const disagreements: string[] = []
const confusion = { humanGoodScorerGood: 0, humanGoodScorerBad: 0, humanBadScorerGood: 0, humanBadScorerBad: 0 }
for (const id of ids.sort()) {
  const r = await ctx.eval.score(id)
  const label = labels[id]
  const verdict = r.passed ? 'PASS' : 'FAIL'
  console.log(`\n${id}  ${verdict}  score ${r.score.toFixed(2)}  (${r.eventCount} events)${label ? `  your label: ${label}` : ''}`)
  for (const x of r.results) console.log(`  ${x.applicable ? (x.pass ? 'ok  ' : 'FAIL') : 'n/a '} ${x.name}${x.required ? '*' : ''}: ${x.detail}`)
  report.push({ sessionId: id, scorer: r.passed ? 'good' : 'bad', ...(label ? { label } : {}), score: r.score, eventCount: r.eventCount })
  if (label) {
    counted++
    if (r.passed === (label === 'good')) agree++
    else disagreements.push(`${id}: scorer says ${verdict}, you said ${label}`)
  }
}

console.log('\n* = required scorer')
if (labelsFile) {
  const rate = counted ? agree / counted : 0
  for (const item of report) {
    if (!item.label) continue
    if (item.label === 'good' && item.scorer === 'good') confusion.humanGoodScorerGood++
    else if (item.label === 'good' && item.scorer === 'bad') confusion.humanGoodScorerBad++
    else if (item.label === 'bad' && item.scorer === 'good') confusion.humanBadScorerGood++
    else confusion.humanBadScorerBad++
  }
  const classCounts = {
    good: Object.values(labels).filter((label) => label === 'good').length,
    bad: Object.values(labels).filter((label) => label === 'bad').length,
  }
  const eligible = meetsCalibrationMinimum(counted, classCounts, MIN_LABELS)
  writeFileSync('calibration-report.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    logDirectory: dir,
    labelsFile,
    checkPattern: checkPattern ?? null,
    minimumIndependentLabels: MIN_LABELS,
    labelledCount: counted,
    classCounts,
    agreement: { correct: agree, total: counted, rate },
    confusion,
    sessions: report,
  }, null, 2) + '\n')
  console.log(`\nreport: calibration-report.json; minimum ${MIN_LABELS} matched labels with both classes: ${eligible ? 'met' : 'NOT MET'}`)
  console.log(`\nagreement with your labels: ${agree}/${counted} (${Math.round(rate * 100)}%)`)
  console.log(`confusion (human label vs scorer): ${JSON.stringify(confusion)}`)
  for (const disagreement of disagreements) console.log(`  DISAGREE ${disagreement}`)
  process.exit(eligible ? 0 : 1)
} else {
  console.log('\nNo labels supplied. This is a scorer report, not a calibration result.')
}
