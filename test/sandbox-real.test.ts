import { Context } from 'cordis'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Subprocess } from '../src/bundles/subprocess/index.js'
import { CrabboxProvider } from '../src/bundles/sandbox-crabbox/index.js'

/**
 * REAL sandbox check. Skipped unless HARNESS_REAL_CRABBOX=1, so a green `npm test` does NOT mean Docker or crabbox ever ran:
 * every other sandbox test uses a fake CLI. Run with `npm run test:real-sandbox` on a machine with Docker running and `crabbox`
 * on PATH. Optional: HARNESS_CRABBOX_RUNTIME=docker|podman, HARNESS_CRABBOX_BIN=<path>.
 */
const real = process.env['HARNESS_REAL_CRABBOX'] === '1'

describe.skipIf(!real)('REAL crabbox + local-container (needs Docker)', () => {
  const mk = async (dir: string) => {
    const ctx = new Context(); await ctx.plugin(Subprocess, { timeoutMs: 600_000 })
    const runtime = process.env['HARNESS_CRABBOX_RUNTIME']
    return new CrabboxProvider(ctx.subprocess, { cwd: dir, bin: process.env['HARNESS_CRABBOX_BIN'] ?? 'crabbox', ...(runtime ? { runtime } : {}), controlTimeoutMs: 600_000 })
  }
  it('doctor passes', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'harness-real-')))
    try { const d = await (await mk(dir)).doctor(); expect(d.ok, d.detail).toBe(true) } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 600_000)
  it('runs inside the box (not on the host), reports exit codes, and releases the lease', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'harness-real-')))
    const hostOnly = join(tmpdir(), `harness-host-sentinel-${Date.now()}.txt`)
    writeFileSync(hostOnly, 'host')
    try {
      const p = await mk(dir)
      const ok = await p.run({ command: ['sh', '-c', 'echo inside; id -u; test ! -e "$1" && echo no-host-file', 'sh', hostOnly], timeoutMs: 300_000 })
      expect(ok.exitCode, ok.stderr).toBe(0)
      expect(ok.stdout).toContain('inside')
      expect(ok.stdout).toContain('no-host-file') // the host sentinel must not exist in the sandbox
      expect(ok.released, ok.releaseNote).toBe(true)
      const bad = await p.run({ command: ['sh', '-c', 'exit 7'], timeoutMs: 300_000 })
      expect(bad.exitCode).toBe(7)
      expect(bad.released, bad.releaseNote).toBe(true)
    } finally { rmSync(hostOnly, { force: true }); rmSync(dir, { recursive: true, force: true }) }
  }, 900_000)
})
