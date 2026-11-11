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
  writeLedger()
  if (process.argv.includes('--check') && summarise(readEvents()).some((r) => r.status === 'HOLD')) {
    console.error('failure ledger has HOLD entries'); process.exit(3)
  }
}
