import { Context } from 'cordis'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Subprocess } from '../src/bundles/subprocess/index.js'
import { CrabboxProvider } from '../src/bundles/sandbox-crabbox/index.js'

/**
 * REAL sandbox check. Skipped unless HARNESS_REAL_CRABBOX=1, so a green npm test does NOT mean Docker or crabbox ever ran.
 * One acceptance test gates warmup on doctor: failed prerequisites stop before a lease is created.
 */
const real = process.env['HARNESS_REAL_CRABBOX'] === '1'

describe.skipIf(!real)('REAL crabbox + local-container (needs Docker)', () => {
  const mk = async (dir: string) => {
    const ctx = new Context(); await ctx.plugin(Subprocess, { timeoutMs: 600_000 })
    const runtime = process.env['HARNESS_CRABBOX_RUNTIME']
    return new CrabboxProvider(ctx.subprocess, {
      cwd: dir,
      bin: process.env['HARNESS_CRABBOX_BIN'] ?? 'crabbox',
      ...(runtime ? { runtime } : {}),
      controlTimeoutMs: 180_000,
      doctorTimeoutMs: 45_000,
      cleanupTimeoutMs: 10_000,
    })
  }

  it('checks doctor before warmup, runs inside the box, reports exit codes, and releases leases', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'harness-real-')))
    const hostOnly = join(tmpdir(), `harness-host-sentinel-${Date.now()}.txt`)
    writeFileSync(hostOnly, 'host')
    try {
      const p = await mk(dir)
      const doctor = await p.doctor()
      expect(doctor.ok, doctor.detail).toBe(true)

      const ok = await p.run({
        command: ['sh', '-c', 'echo inside; id -u; test ! -e "$1" && echo no-host-file', 'sh', hostOnly],
        timeoutMs: 300_000,
      })
      expect(ok.exitCode, ok.stderr).toBe(0)
      expect(ok.stdout).toContain('inside')
      expect(ok.stdout).toContain('no-host-file')
      expect(ok.released, ok.releaseNote).toBe(true)

      const bad = await p.run({ command: ['sh', '-c', 'exit 7'], timeoutMs: 300_000 })
      expect(bad.exitCode).toBe(7)
      expect(bad.released, bad.releaseNote).toBe(true)
    } finally {
      rmSync(hostOnly, { force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  }, 600_000)
})
