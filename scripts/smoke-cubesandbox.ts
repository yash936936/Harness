/**
 * 5.2 integration check against a REAL CubeSandbox (needs an x86_64 Linux KVM host running CubeAPI, a READY template, and `npm i e2b`).
 *   HARNESS_CUBE_URL=https://cube.host:3000 HARNESS_CUBE_TEMPLATE=<template> [HARNESS_CUBE_KEY=...] [HARNESS_CUBE_BUDGET_MS=200] npx tsx scripts/smoke-cubesandbox.ts
 * Checks the two 5.2 success criteria: boot-to-ready vs the budget, and that a command cannot read a host-only file.
 * The default `e2b` wiring in the provider is UNVERIFIED until this passes once.
 */
import { Context } from 'cordis'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { Subprocess } from '../src/bundles/subprocess/index.js'
import { Sandbox } from '../src/bundles/sandbox/index.js'
import { CubeSandboxProvider } from '../src/bundles/sandbox-cubesandbox/index.js'

const url = process.env['HARNESS_CUBE_URL']
const template = process.env['HARNESS_CUBE_TEMPLATE']
if (!url || !template) { console.error('set HARNESS_CUBE_URL and HARNESS_CUBE_TEMPLATE'); process.exit(1) }
const budget = Number(process.env['HARNESS_CUBE_BUDGET_MS'] ?? 200)
const ctx = new Context()
await ctx.plugin(EgressPolicy, { projectId: 'smoke-cube', allowedHosts: [new URL(url).hostname] })
await ctx.egress.grantConsent() // remote destination: running this script is you consenting
await ctx.plugin(Subprocess)
await ctx.plugin(Sandbox)
ctx.sandbox.register(new CubeSandboxProvider({ apiUrl: url, apiKey: process.env['HARNESS_CUBE_KEY'], template, bootBudgetMs: budget }))

let failed = 0
const check = (label: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failed++ }

const boots: number[] = []
for (let i = 0; i < 5; i++) {
  const r = await ctx.sandbox.run({ command: ['echo', 'hi'] })
  boots.push(r.bootMs ?? -1)
  if (i === 0) check('boot + run + output', r.exitCode === 0 && r.stdout.includes('hi'), `exit=${r.exitCode}`)
  if (!r.released) check('sandbox killed', false, r.releaseNote ?? '')
}
boots.sort((a, b) => a - b)
check(`boot median within ${budget} ms budget`, boots[2]! <= budget, `boots(ms)=${boots.join(',')}  (claimed <60 ms bare-metal; the budget is yours to set)`)

// Isolation: a host-only file with a random secret must not be readable from inside.
const dir = mkdtempSync(join(tmpdir(), 'harness-cube-iso-'))
const secret = randomBytes(12).toString('hex')
const hostFile = join(dir, 'host-only.txt')
writeFileSync(hostFile, secret)
try {
  const r = await ctx.sandbox.run({ command: ['cat', hostFile] })
  check('host-only file is NOT readable inside the sandbox', !r.stdout.includes(secret) && r.exitCode !== 0, `exit=${r.exitCode} stderr=${r.stderr.trim().slice(0, 80)}`)
  check('sandbox killed after isolation test', r.released, r.releaseNote ?? '')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(failed ? `\n${failed} check(s) FAILED. Paste this output back whole.` : '\nAll checks passed. Paste this output back whole.')
process.exit(failed ? 1 : 0)
