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
import { meetsCalibrationMinimum, validateHumanRunLabels } from './eval-calibrate-validation.js'

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
  try {
    labels = validateHumanRunLabels(parsed, []).labels
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
