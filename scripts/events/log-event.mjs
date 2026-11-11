#!/usr/bin/env node
// Append one event. Examples:
// node scripts/events/log-event.mjs --kind review --area S3 --outcome success --summary "Inspected session JSONL"
// node scripts/events/log-event.mjs --kind resolution --area S0 --signature "<sig>" --summary "Put on hold, D-110"
import { appendEvent } from './lib.mjs'
import { writeLedger } from './failure-report.mjs'

const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[++i]
}
if (!args.summary && !args.cmd) { console.error('need --summary or --cmd'); process.exit(2) }
const rec = appendEvent({ kind: args.kind, area: args.area, outcome: args.outcome, summary: args.summary, cmd: args.cmd, signature: args.signature, ref: args.ref, actor: args.actor || process.env.HARNESS_ACTOR })
writeLedger()
console.log(`logged ${rec.kind} @ ${rec.ts}`)
