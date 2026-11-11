#!/usr/bin/env node
// Check the new agent-workflow docs and generated component references without rewriting historical evidence docs.
import fs from 'node:fs'
import path from 'node:path'

const problems = []
const need = ['AGENTS.md', 'docs/components/README.md', 'docs/FAILURE-LEDGER.md', 'docs/logs/events.jsonl']
if (!fs.existsSync('context.md')) problems.push('context.md missing')
else {
  const ctx = fs.readFileSync('context.md', 'utf8')
  for (const n of need) if (!ctx.includes(n)) problems.push(`context.md does not mention ${n}`)
}
for (const n of need) if (!fs.existsSync(n)) problems.push(`missing ${n}`)

const mdFiles = ['docs/FAILURE-LEDGER.md', 'docs/BRANCH-PROTECTION.md', 'docs/REFACTOR-PLAN.md']
const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.md')) mdFiles.push(p) } }
walk('docs/components')
for (const f of mdFiles) {
  const src = fs.readFileSync(f, 'utf8')
  if (!/\*\*Next:\*\*[^\n]*context\.md/.test(src)) problems.push(`${f}: no "Next: ... context.md" line`)
  for (const m of src.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)(?:#[^)]*)?\)/g)) {
    const target = path.resolve(path.dirname(f), m[1])
    if (!fs.existsSync(target)) problems.push(`${f}: broken link ${m[1]}`)
  }
}
if (problems.length) { console.error('Docs problems:\n - ' + problems.join('\n - ')); process.exit(1) }
console.log('docs ok')
