// Shared helpers for the event log. No dependencies. Node >= 20.
import fs from 'node:fs'
import path from 'node:path'

export const LOG_PATH = path.resolve('docs/logs/events.jsonl')
export const LEDGER_PATH = path.resolve('docs/FAILURE-LEDGER.md')
export const DEFAULT_HOLD_THRESHOLD = Number(process.env.HARNESS_HOLD_THRESHOLD || 3)

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /((?:api[_-]?key|token|secret|password|authorization)\s*[=:]\s*)\S+/gi,
]

/** Remove anything that looks like a credential, including live env values. */
export function redact(text) {
  let out = String(text ?? '')
  for (const [name, value] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD/i.test(name) && value && value.length >= 8) {
      out = out.split(value).join('[redacted:env]')
    }
  }
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m, p1) => (p1 ? `${p1}[redacted]` : '[redacted]'))
  }
  return out
}

/** Stable failure signature with volatile paths, hashes and numbers normalised. */
export function signatureOf(output, fallback = 'unknown failure') {
  const lines = String(output ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return fallback
  const hit = [...lines].reverse().find((l) => /error|fail|cannot|denied|not found|timeout|exception|refused|enoent|exit(ed)? /i.test(l))
  const line = hit ?? lines[lines.length - 1]
  return redact(line).toLowerCase()
    .replace(/[a-z]:\\[^\s"']+/g, '<path>')
    .replace(/(?:\.{0,2}\/)[^\s"']+/g, '<path>')
    .replace(/\b[0-9a-f]{7,}\b/g, '<hex>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .replace(/\S*\[redacted[^\]]*\]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, 140)
}

export function readEvents(file = LOG_PATH) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l, i) => {
    try { return JSON.parse(l) } catch { throw new Error(`corrupt event log line ${i + 1} in ${file}`) }
  })
}

export function appendEvent(ev, file = LOG_PATH) {
  const record = { ts: new Date().toISOString(), kind: 'note', actor: process.env.HARNESS_ACTOR || 'unknown', ...ev }
  for (const k of ['summary', 'cmd', 'signature', 'tail']) if (record[k]) record[k] = redact(record[k])
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(record) + '\n')
  return record
}

/** Failures per (area, signature) since that signature's last resolution. */
export function summarise(events, threshold = DEFAULT_HOLD_THRESHOLD) {
  const map = new Map()
  for (const e of events) {
    if (!e.signature) continue
    const key = `${e.area || '-'}\u0000${e.signature}`
    const row = map.get(key) ?? { area: e.area || '-', signature: e.signature, count: 0, total: 0, first: e.ts, last: e.ts, lastCmd: '', resolved: false }
    if (e.kind === 'resolution') { row.count = 0; row.resolved = true; row.resolution = e.summary }
    else if (e.outcome === 'failure') { row.count += 1; row.total += 1; row.last = e.ts; row.lastCmd = e.cmd || row.lastCmd; row.resolved = false; if (row.total === 1) row.first = e.ts }
    map.set(key, row)
  }
  return [...map.values()].map((r) => ({ ...r, status: r.count >= threshold ? 'HOLD' : r.count >= 2 ? 'watch' : r.count === 1 ? 'seen' : /hold/i.test(r.resolution || '') ? 'on-hold' : 'resolved' }))
    .sort((a, b) => b.count - a.count || b.total - a.total || a.signature.localeCompare(b.signature))
}
