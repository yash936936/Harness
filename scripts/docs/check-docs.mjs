#!/usr/bin/env node
// Check maintained Markdown links across the repository without rewriting historical evidence docs.
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

const markdown = []
const walk = (dir) => {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.harness') continue
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (entry.isFile() && file.endsWith('.md')) markdown.push(file)
  }
}
walk('.')

const componentDocs = markdown.filter((file) => file.startsWith(path.join('docs', 'components') + path.sep))
for (const file of componentDocs) {
  const src = fs.readFileSync(file, 'utf8')
  if (!/\*\*Next:\*\*[^\n]*context\.md/.test(src)) problems.push(`${file}: no "**Next: ... context.md" line`)
}

for (const file of markdown) {
  const src = fs.readFileSync(file, 'utf8')
  for (const match of src.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)(?:#[^)]*)?\)/g)) {
    const target = path.resolve(path.dirname(file), decodeURIComponent(match[1]))
    if (!fs.existsSync(target)) problems.push(`${file}: broken link ${match[1]}`)
  }
}
if (problems.length) { console.error('Docs problems:\\n - ' + problems.join('\\n - ')); process.exit(1) }
console.log(`docs ok (${markdown.length} Markdown files checked)`)
