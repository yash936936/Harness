/**
 * Phase 6.2 on REAL data: compare scorer verdicts with independently assigned human labels.
 *
 * Usage:
 *   npx tsx scripts/eval-calibrate.ts <logDir> <committed-labels.json> [checkCommandRegex]
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
import { verifyCommittedLabels } from './eval-label-provenance.js'

const [dir, labelsFile, checkPattern] = process.argv.slice(2)
if (!dir || !labelsFile) {
  console.error('usage: npx tsx scripts/eval-calibrate.ts <logDir> <committed-labels.json> [checkCommandRegex]')
  console.error('D-109: committed human labels are required; scorer-only output before labels is prohibited.')
  process.exit(2)
}

{
  try {
    const provenance = verifyCommittedLabels(labelsFile)
    console.log(`D-109 labels verified: SHA-256 ${provenance.sha256}; commit ${provenance.commit}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
}

let parsedLabels: unknown
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

let labels: Record<string, 'good' | 'bad'>
let classCounts: { good: number; bad: number }
let minimumLabels = 10
try {
  const validated = validateHumanRunLabels(parsedLabels, ids)
  if (validated.unknownIds.length) {
    console.error(`labels reference sessions not present in log directory: ${validated.unknownIds.join(', ')}`)
    process.exit(2)
  }
  labels = validated.labels
  classCounts = validated.classCounts
  minimumLabels = ids.length >= 20 ? 20 : 10
  if (!meetsCalibrationMinimum(Object.keys(labels).length, classCounts, minimumLabels)) {
    console.error(`D-109: refusing to generate scorer output. Need at least ${minimumLabels} committed human labels with both good and bad classes; found ${Object.keys(labels).length} (good=${classCounts.good}, bad=${classCounts.bad}).`)
    process.exit(2)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}

let counted = 0
let agree = 0
const report: Array<{ sessionId: string; scorer: 'good' | 'bad'; label?: 'good' | 'bad'; score: number; eventCount: number }> = []
const disagreements: string[] = []
const confusion = { humanGoodScorerGood: 0, humanGoodScorerBad: 0, humanBadScorerGood: 0, humanBadScorerBad: 0 }
for (const id of ids.sort()) {
  const r = await ctx.eval.score(id)
  const label = labels[id]
  const verdict = r.passed ? 'PASS' : 'FAIL'
  console.log(`\n${id}  ${verdict}  score ${r.score.toFixed(2)}  (${r.eventCount} events)${label ? `  human label: ${label}` : '  unlabelled'}`)
  for (const x of r.results) console.log(`  ${x.applicable ? (x.pass ? 'ok  ' : 'FAIL') : 'n/a '} ${x.name}${x.required ? '*' : ''}: ${x.detail}`)
  report.push({ sessionId: id, scorer: r.passed ? 'good' : 'bad', ...(label ? { label } : {}), score: r.score, eventCount: r.eventCount })
  if (label) {
    counted++
    if (r.passed === (label === 'good')) agree++
    else disagreements.push(`${id}: scorer says ${verdict}, you said ${label}`)
  }
}

console.log('\n* = required scorer')
{
  const rate = counted ? agree / counted : 0
  for (const item of report) {
    if (!item.label) continue
    if (item.label === 'good' && item.scorer === 'good') confusion.humanGoodScorerGood++
    else if (item.label === 'good' && item.scorer === 'bad') confusion.humanGoodScorerBad++
    else if (item.label === 'bad' && item.scorer === 'good') confusion.humanBadScorerGood++
    else confusion.humanBadScorerBad++
  }
  const eligible = meetsCalibrationMinimum(counted, classCounts, minimumLabels)
  writeFileSync('calibration-report.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    logDirectory: dir,
    labelsFile,
    checkPattern: checkPattern ?? null,
    minimumIndependentLabels: minimumLabels,
    labelledCount: counted,
    classCounts,
    agreement: { correct: agree, total: counted, rate },
    confusion,
    sessions: report,
  }, null, 2) + '\n')
  console.log(`\nreport: calibration-report.json; minimum ${minimumLabels} matched labels with both classes: ${eligible ? 'met' : 'NOT MET'}`)
  console.log(`\nagreement with your labels: ${agree}/${counted} (${Math.round(rate * 100)}%)`)
  console.log(`confusion (human label vs scorer): ${JSON.stringify(confusion)}`)
  for (const disagreement of disagreements) console.log(`  DISAGREE ${disagreement}`)
  process.exit(eligible ? 0 : 1)
