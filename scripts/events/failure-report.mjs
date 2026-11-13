#!/usr/bin/env node
// Regenerate docs/FAILURE-LEDGER.md from docs/logs/events.jsonl (never edit the ledger by hand).
// --check exits 3 if any signature is on HOLD.
import fs from 'node:fs'
import { readEvents, summarise, LEDGER_PATH, DEFAULT_HOLD_THRESHOLD } from './lib.mjs'

export function renderLedger(events, threshold = DEFAULT_HOLD_THRESHOLD) {
  const rows = summarise(events, threshold)
  const lines = [
    '# Failure ledger', '',
    '> GENERATED from `docs/logs/events.jsonl` by `scripts/events/failure-report.mjs`. Do not edit by hand.',
    `> Ordered by current occurrence count (failures since the last logged resolution), highest first. HOLD threshold: ${threshold}.`, ''
  ]
  if (!rows.length) lines.push('_No failures recorded._')
  else {
    lines.push('| # | Count | Total | Status | Area | Signature | First seen | Last seen | Last command |', '|--:|--:|--:|---|---|---|---|---|---|')
    rows.forEach((r, i) => {
      const signature = r.signature.replaceAll('|', '\\|')
      const command = r.lastCmd ? '`' + r.lastCmd.replaceAll('|', '\\|').slice(0, 80) + '`' : ''
      lines.push(`| ${i + 1} | ${r.count} | ${r.total} | ${r.status} | ${r.area} | \`${signature}\` | ${r.first.slice(0, 10)} | ${r.last.slice(0, 10)} | ${command} |`)
    })
  }
  lines.push('', '**HOLD** = the same failure recurred at least the threshold number of times without a resolution. Stop retrying it. See AGENTS.md, "Repeated failure rule". Log a `resolution` event once the part is changed wholesale or put on hold with a decision ID.', '', '---', '**Next:** Return to [`context.md`](../context.md).', '')
  return lines.join('\n')
}
export function writeLedger() { fs.writeFileSync(LEDGER_PATH, renderLedger(readEvents())) }
if (process.argv[1]?.endsWith('failure-report.mjs')) {
  const events = readEvents()
  if (process.argv.includes('--check')) {
    const expected = renderLedger(events)
    const actual = fs.existsSync(LEDGER_PATH) ? fs.readFileSync(LEDGER_PATH, 'utf8') : ''
    let failed = false
    if (actual !== expected) {
      console.error('failure ledger is stale; run npm run events:report and commit the result')
      failed = true
    }
    if (summarise(events).some((r) => r.status === 'HOLD')) {
      console.error('failure ledger has HOLD entries')
      failed = true
    }
    if (failed) process.exit(3)
    console.log('failure ledger is current and has no HOLD entries')
  } else {
    writeLedger()
  }
}
