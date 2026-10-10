/**
 * 5.1 integration check against a REAL crabbox (not run by CI; needs `crabbox` on PATH and, for local-container, Docker/Podman running).
 *   npx tsx scripts/smoke-crabbox.ts
 *   HARNESS_CRABBOX_PROVIDER=local-container HARNESS_CRABBOX_IMAGE=node:22-bookworm HARNESS_CRABBOX_VERSION=<pin> npx tsx scripts/smoke-crabbox.ts
 * Measures (D-024): the lease -> run -> release cost, whether the lease is confirmed released, and what a failing command does.
 * Run it from inside a git repository (crabbox syncs the working repo): the Harness repo root is one. On Windows set HARNESS_CRABBOX_RUNTIME=docker
 * (the official Windows guide's own smoke does). On Windows crabbox also needs rsync; if `doctor` fails, that is the finding, paste it.
 */
import { Context } from 'cordis'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { Subprocess } from '../src/bundles/subprocess/index.js'
import { Sandbox } from '../src/bundles/sandbox/index.js'
import { CrabboxProvider } from '../src/bundles/sandbox-crabbox/index.js'

const provider = process.env['HARNESS_CRABBOX_PROVIDER'] ?? 'local-container'
const ctx = new Context()
await ctx.plugin(EgressPolicy, { projectId: 'smoke-crabbox', allowedHosts: process.env['HARNESS_CRABBOX_HOST'] ? [process.env['HARNESS_CRABBOX_HOST']] : [] })
if (provider !== 'local-container') await ctx.egress.grantConsent() // a remote provider needs consent; this smoke run is you consenting
await ctx.plugin(Subprocess, { timeoutMs: 600_000 })
await ctx.plugin(Sandbox)
ctx.sandbox.register(new CrabboxProvider(ctx.subprocess, { provider, image: process.env['HARNESS_CRABBOX_IMAGE'], runtime: process.env['HARNESS_CRABBOX_RUNTIME'], expectedVersion: process.env['HARNESS_CRABBOX_VERSION'], host: process.env['HARNESS_CRABBOX_HOST'] }))

let failed = 0
const check = (label: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failed++ }

const d = (await ctx.sandbox.doctor())['crabbox']!
check('doctor', d.ok, d.detail)
if (!d.ok) { console.log('doctor failed: fix that first (Docker running? rsync on Windows? version pin?).'); process.exit(1) }

const a = await ctx.sandbox.run({ command: ['echo', 'harness-5.1'] })
check('lease -> echo -> output', a.exitCode === 0 && a.stdout.includes('harness-5.1'), `exit=${a.exitCode} ${a.durationMs}ms`)
check('lease confirmed released', a.released, a.releaseNote ?? a.leaseId)

const b = await ctx.sandbox.run({ command: ['sh', '-c', 'exit 3'] })
check('failing command: exit code returned, lease still released', b.exitCode === 3 && b.released, `exit=${b.exitCode} ${b.releaseNote ?? ''}`)

console.log(failed ? `\n${failed} check(s) FAILED. Paste this output back whole.` : '\nAll checks passed. Paste this output back whole; it is the first real measurement of 5.1.')
process.exit(failed ? 1 : 0)
