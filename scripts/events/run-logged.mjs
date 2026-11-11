#!/usr/bin/env node
// Run a command, log its outcome (redacted), refresh the failure ledger, and print a HOLD banner at threshold.
import { spawnSync } from 'node:child_process'
import { appendEvent, signatureOf, redact, readEvents, summarise, DEFAULT_HOLD_THRESHOLD } from './lib.mjs'
import { writeLedger } from './failure-report.mjs'

const argv = process.argv.slice(2)
const sep = argv.indexOf('--')
if (sep < 0 || sep === argv.length - 1) { console.error('usage: run-logged.mjs [--area X] [--shell] -- <command> [args]'); process.exit(2) }
const opts = argv.slice(0, sep), cmd = argv.slice(sep + 1)
const area = opts.includes('--area') ? opts[opts.indexOf('--area') + 1] : undefined
const useShell = opts.includes('--shell')
const started = Date.now()
const r = useShell
  ? spawnSync(cmd.join(' '), { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  : spawnSync(cmd[0], cmd.slice(1), { shell: false, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const out = (r.stdout || '') + (r.stderr || '')
process.stdout.write(r.stdout || '')
process.stderr.write(r.stderr || '')
const code = r.error ? 127 : (r.status ?? 1), ok = code === 0
const combined = r.error ? `${r.error.message}\n${out}` : out
appendEvent({ kind: 'command', area, cmd: redact(cmd.join(' ')), exit: code, outcome: ok ? 'success' : 'failure',
  durationMs: Date.now() - started, signature: ok ? undefined : signatureOf(combined), tail: ok ? undefined : redact(combined.split(/\r?\n/).slice(-12).join('\n')) })
writeLedger()
if (!ok) {
  const row = summarise(readEvents()).find((x) => x.area === (area || '-') && x.signature === signatureOf(combined))
  if (row && row.status === 'HOLD') console.error(`\n=== HOLD: this failure has now occurred ${row.count} times (threshold ${DEFAULT_HOLD_THRESHOLD}) ===\nSignature: ${row.signature}\nStop retrying. Follow AGENTS.md "Repeated failure rule".`)
}
process.exit(code)
