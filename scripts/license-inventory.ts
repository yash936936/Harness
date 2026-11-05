/** Regenerate a lockfile license metadata inventory. This is not a release-artifact or legal review. */
import { readFileSync, writeFileSync } from 'node:fs'
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const rows = Object.entries(lock.packages ?? {}).filter(([p]) => p.startsWith('node_modules/')).map(([p, v]: [string, any]) => ({ name: p.slice('node_modules/'.length), version: v.version ?? 'unknown', license: typeof v.license === 'string' ? v.license : Array.isArray(v.license) ? v.license.join(' OR ') : 'UNDECLARED' })).sort((a, b) => a.name.localeCompare(b.name))
const counts = Object.fromEntries([...new Set(rows.map((r) => r.license))].sort().map((license) => [license, rows.filter((r) => r.license === license).length]))
const md = ['# Third-party dependency license inventory', '', `Generated from package-lock.json (${rows.length} package entries). Lockfile metadata only; not a legal conclusion or a shipped-artifact inventory.`, '', '## Counts', '', ...Object.entries(counts).map(([license, count]) => `- ${license}: ${count}`), '', '## Packages', '', '| Package | Version | License metadata |', '|---|---:|---|', ...rows.map((r) => `| \`${r.name}\` | ${r.version} | ${r.license} |`), ''].join('\n')
writeFileSync('THIRD_PARTY_LICENSES.generated.md', md)
console.log(`Wrote THIRD_PARTY_LICENSES.generated.md (${rows.length} entries). Review undeclared licenses and actual release artifacts separately.`)
