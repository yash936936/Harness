#!/usr/bin/env node
// Generate / verify docs/components/<area>.md from the source tree.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd(), OUT = path.join(ROOT, 'docs/components')
const BEGIN = '<!-- BEGIN GENERATED: do not edit between markers -->', END = '<!-- END GENERATED -->'
const check = process.argv.includes('--check')
const rel = (p) => p.split(path.sep).join('/')
const listDir = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []

function areas() {
  const out = []
  for (const e of listDir(path.join(ROOT, 'src/bundles'))) if (e.isDirectory()) out.push({ name: e.name, dir: path.join(ROOT, 'src/bundles', e.name), kind: 'bundle' })
  for (const n of ['cli', 'profiles', 'util']) if (fs.existsSync(path.join(ROOT, 'src', n))) out.push({ name: n, dir: path.join(ROOT, 'src', n), kind: 'support' })
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
function walk(dir) { return listDir(dir).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]).sort() }
function headerComment(src) {
  const m = src.match(/^\s*(?:\/\*\*?([\s\S]*?)\*\/|((?:\/\/[^\n]*\n?)+))/)
  if (!m) return ''
  return (m[1] ?? m[2]).split('\n').map((l) => l.replace(/^\s*(\*|\/)\/?\s?/, '').trim()).filter(Boolean)[0] ?? ''
}
function exportsOf(src) {
  const names = new Set()
  for (const m of src.matchAll(/^export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(class|function\*?|const|let|interface|type|enum)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[2])
  for (const m of src.matchAll(/^export\s*\{([^}]+)\}/gm)) m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean).forEach((n) => names.add(n))
  return [...names]
}
function bundleDeps(src, self) {
  const deps = new Set()
  for (const m of src.matchAll(/from\s+['"]((?:\.\.\/)+(?:bundles\/)?([a-z0-9-]+))(?:\/[^'"]*)?['"]/g)) if (m[2] !== self && m[2] !== 'util') deps.add(m[2])
  return [...deps]
}
function testsFor(name) { return listDir(path.join(ROOT, 'test')).filter((e) => e.isFile() && e.name.startsWith(name) && /\.test\.ts$/.test(e.name)).map((e) => `test/${e.name}`) }
function generated(area) {
  const files = walk(area.dir).filter((f) => /\.(ts|yml)$/.test(f)), deps = new Set()
  const rows = files.map((f) => {
    const src = fs.readFileSync(f, 'utf8')
    bundleDeps(src, area.name).forEach((d) => deps.add(d))
    const ex = f.endsWith('.ts') ? exportsOf(src) : [], note = f.endsWith('.ts') ? headerComment(src) : ''
    return `| \`${rel(path.relative(ROOT, f))}\` | ${ex.length ? ex.map((x) => '\`' + x + '\`').join(', ') : '-'} | ${note || '**(no header comment)**'} |`
  })
  const tests = testsFor(area.name)
  return [BEGIN, '', '### Files and exports', '', '| File | Exports | Responsibility (first header-comment line) |', '|---|---|---|', ...rows, '',
    `**Imports other areas:** ${deps.size ? [...deps].sort().map((d) => '\`' + d + '\`').join(', ') : '(none)'}`, '',
    `**Tests:** ${tests.length ? tests.map((t) => '\`' + t + '\`').join(', ') : '(none matched by name)'}`, '', END].join('\n')
}
function skeleton(area) {
  return [`# Component: ${area.name}`, '', `> Area type: ${area.kind}. Location: \`${rel(path.relative(ROOT, area.dir))}/\`. Hand-written sections below are yours to edit; the generated block is rewritten by \`npm run docs:components\`.`, '',
    '## Purpose', '(open — one or two sentences: what this component is responsible for, and what it must NOT do)', '',
    '## Route (how control reaches it)', '(open — who registers or calls it, in what order, and what it calls next; name the ctx key, hooks or events)', '',
    '## Config surface and invariants', '(open — config keys, limits, fail-closed behaviour, anything a caller must never assume)', '',
    '## Known limits', '(open — honest list, linked to decision / debug IDs)', '', ''].join('\n')
}
if (!check) fs.mkdirSync(OUT, { recursive: true })
const problems = [], index = []
for (const area of areas()) {
  const file = path.join(OUT, `${area.name}.md`), block = generated(area)
  let doc = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : skeleton(area) + block + '\n\n---\n**Next:** Return to [`context.md`](../../context.md).\n'
  if (!doc.includes(BEGIN)) doc = doc.replace(/\n---\n\*\*Next:\*\*/, `\n${block}\n\n---\n**Next:**`)
  const next = doc.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}`), () => block)
  if (!fs.existsSync(file)) problems.push(`missing doc: docs/components/${area.name}.md`)
  else if (next !== doc) problems.push(`stale generated block: docs/components/${area.name}.md`)
  if (/\(open — /.test(next)) {
    const message = `docs/components/${area.name}.md still has unfilled hand-written sections`
    console.warn(`${check ? 'error' : 'warn'}: ${message}`)
    if (check) problems.push(message)
  }
  if (!check) fs.writeFileSync(file, next)
  index.push(`| \`${area.name}\` | ${area.kind} | \`${rel(path.relative(ROOT, area.dir))}/\` |`)
}
const readme = ['# Component docs', '', 'One file per area (bundle, cli, profiles, util). Generated parts stay in sync with `src/`. Hand-written sections document purpose, route, config and known limits.', '', '| Component | Type | Location |', '|---|---|---|', ...index, '', '---', '**Next:** Return to [`context.md`](../../context.md).', ''].join('\n')
const readmePath = path.join(OUT, 'README.md')
if (fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') !== readme : true) { if (check) problems.push('stale: docs/components/README.md'); else fs.writeFileSync(readmePath, readme) }
if (check && problems.length) { console.error('Component docs drift:\n - ' + problems.join('\n - ') + '\nRun: npm run docs:components'); process.exit(1) }
console.log(check ? 'component docs in sync' : `wrote ${index.length} component docs`)
