import { Context } from 'cordis'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Subprocess, SubprocessError, WINDOWS_REQUIRED_ENV_VARS } from '../src/bundles/subprocess/index.js'

// Every test shells out to Node itself (process.execPath), never a POSIX builtin like
// `echo`: this suite runs on the owner's Windows machine as well as Linux CI, and only
// node is guaranteed to be the same executable on both without relying on PATH/shell.
const NODE = process.execPath

async function boot(config: ConstructorParameters<typeof Subprocess>[1] = {}) {
  const ctx = new Context()
  await ctx.plugin(Subprocess, config)
  return ctx
}

/**
 * Asserts the child's env is exactly `expected`, plus -- on Windows only --
 * whatever subset of WINDOWS_REQUIRED_ENV_VARS Node injected on its own
 * (D-031, confirmed with a bundle-independent repro). Any OTHER extra key
 * is a real leak and fails this the same way a plain toEqual would; only
 * Node's own documented, platform-mandatory baseline is exempted.
 */
function expectChildEnv(actualJson: string, expected: Record<string, string>) {
  const actual = JSON.parse(actualJson)
  for (const [k, v] of Object.entries(expected)) {
    expect(actual).toHaveProperty(k, v)
  }
  const extraKeys = Object.keys(actual).filter((k) => !(k in expected))
  for (const k of extraKeys) {
    expect(WINDOWS_REQUIRED_ENV_VARS).toContain(k)
  }
}

describe('subprocess: happy path', () => {
  it('captures stdout and a zero exit code', async () => {
    const ctx = await boot()
    const res = await ctx.subprocess.run(NODE, ['-e', "process.stdout.write('hi')"])
    expect(res.stdout).toBe('hi')
    expect(res.exitCode).toBe(0)
    expect(res.signal).toBeNull()
    expect(res.spawnError).toBeUndefined()
    expect(res.command).toBe(NODE)
    expect(res.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('captures stderr separately from stdout', async () => {
    const ctx = await boot()
    const res = await ctx.subprocess.run(NODE, ['-e', "process.stdout.write('out'); process.stderr.write('err')"])
    expect(res.stdout).toBe('out')
    expect(res.stderr).toBe('err')
  })
})

describe('subprocess: env allowlist (security)', () => {
  it('a secret set in the parent env is invisible to the child unless allowlisted', async () => {
    process.env['HARNESS_TEST_SECRET'] = 'sk-super-secret-value'
    try {
      const ctx = await boot({ envAllowlist: ['HARNESS_TEST_VISIBLE'] })
      process.env['HARNESS_TEST_VISIBLE'] = 'visible-value'
      const res = await ctx.subprocess.run(NODE, ['-e', 'process.stdout.write(JSON.stringify(process.env))'])
      expect(res.stdout).not.toContain('sk-super-secret-value')
      expect(res.stdout).not.toContain('HARNESS_TEST_SECRET')
      expectChildEnv(res.stdout, { HARNESS_TEST_VISIBLE: 'visible-value' })
    } finally {
      delete process.env['HARNESS_TEST_SECRET']
      delete process.env['HARNESS_TEST_VISIBLE']
    }
  })

  it("with an empty allowlist the child sees nothing but (on Windows) Node's own required baseline", async () => {
    process.env['HARNESS_TEST_SECRET'] = 'nope'
    try {
      const ctx = await boot()
      const res = await ctx.subprocess.run(NODE, ['-e', 'process.stdout.write(JSON.stringify(process.env))'])
      expect(res.stdout).not.toContain('nope')
      expect(res.stdout).not.toContain('HARNESS_TEST_SECRET')
      expectChildEnv(res.stdout, {})
    } finally {
      delete process.env['HARNESS_TEST_SECRET']
    }
  })

  it('the empty-allowlist child env is exactly WINDOWS_REQUIRED_ENV_VARS on Windows, or nothing on POSIX', async () => {
    const ctx = await boot()
    const res = await ctx.subprocess.run(NODE, ['-e', 'process.stdout.write(JSON.stringify(process.env))'])
    const keys = Object.keys(JSON.parse(res.stdout)).sort()
    expect(keys).toEqual([...WINDOWS_REQUIRED_ENV_VARS].sort())
  })

  it('per-call env values only reach the child for allowlisted keys, and win over the parent env', async () => {
    // DBG-008: this test originally only read back ONE var and printed just its value, which
    // passed even on a run where the child's environment was actually fully leaked (see
    // DBG-008) -- reading one key out of a leaked object still returns the right value. Dump
    // and check the WHOLE child environment here, the same way the other security tests do, so
    // a leak can't hide behind a narrow assertion again.
    process.env['HARNESS_TEST_OVERRIDE'] = 'from-parent'
    try {
      const ctx = await boot({ envAllowlist: ['HARNESS_TEST_OVERRIDE'] })
      const res = await ctx.subprocess.run(NODE, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], {
        env: { HARNESS_TEST_OVERRIDE: 'from-call' },
      })
      expectChildEnv(res.stdout, { HARNESS_TEST_OVERRIDE: 'from-call' })
    } finally {
      delete process.env['HARNESS_TEST_OVERRIDE']
    }
  })

  it('throws SubprocessError before spawning if `env` sets a key outside every allowlist', async () => {
    const ctx = await boot({ envAllowlist: ['ALLOWED'] })
    await expect(ctx.subprocess.run(NODE, ['-e', '0'], { env: { NOT_ALLOWED: 'x' } })).rejects.toBeInstanceOf(SubprocessError)
  })

  it('a per-call envAllowlist entry is additive, not a replacement for the bundle default', async () => {
    process.env['HARNESS_TEST_BASE'] = 'base'
    process.env['HARNESS_TEST_EXTRA'] = 'extra'
    try {
      const ctx = await boot({ envAllowlist: ['HARNESS_TEST_BASE'] })
      const res = await ctx.subprocess.run(NODE, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], {
        envAllowlist: ['HARNESS_TEST_EXTRA'],
      })
      expectChildEnv(res.stdout, { HARNESS_TEST_BASE: 'base', HARNESS_TEST_EXTRA: 'extra' })
    } finally {
      delete process.env['HARNESS_TEST_BASE']
      delete process.env['HARNESS_TEST_EXTRA']
    }
  })
})

describe('subprocess: failure modes are surfaced, not swallowed', () => {
  it('a non-zero exit code and its stderr both come back', async () => {
    const ctx = await boot()
    const res = await ctx.subprocess.run(NODE, ['-e', "process.stderr.write('boom'); process.exit(3)"])
    expect(res.exitCode).toBe(3)
    expect(res.stderr).toBe('boom')
    expect(res.spawnError).toBeUndefined()
  })

  it('a command that does not exist resolves with spawnError, and does not throw', async () => {
    const ctx = await boot()
    const res = await ctx.subprocess.run('this-command-does-not-exist-xyz')
    expect(res.exitCode).toBeNull()
    expect(res.signal).toBeNull()
    expect(res.spawnError).toBeTruthy()
  })

  it('a killing signal is reported (POSIX only: Windows has no real signal delivery)', async () => {
    if (process.platform === 'win32') return
    const ctx = await boot()
    const res = await ctx.subprocess.run(NODE, ['-e', 'process.kill(process.pid, "SIGKILL")'])
    expect(res.exitCode).toBeNull()
    expect(res.signal).toBe('SIGKILL')
  })
})

describe('subprocess: timeout and abort', () => {
  it('a run exceeding timeoutMs is killed and marked timedOut', async () => {
    const ctx = await boot()
    const res = await ctx.subprocess.run(NODE, ['-e', 'setTimeout(() => {}, 30000)'], { timeoutMs: 100 })
    expect(res.timedOut).toBe(true)
    expect(res.exitCode).not.toBe(0)
  }, 10_000)

  it('an aborted run is killed and marked aborted, not timedOut', async () => {
    const ctx = await boot()
    const ac = new AbortController()
    const p = ctx.subprocess.run(NODE, ['-e', 'setTimeout(() => {}, 30000)'], { signal: ac.signal })
    setTimeout(() => ac.abort(), 50)
    const res = await p
    expect(res.aborted).toBe(true)
    expect(res.timedOut).toBe(false)
  }, 10_000)

  it('a fast run under an abort signal that never fires completes normally', async () => {
    const ctx = await boot()
    const ac = new AbortController()
    const res = await ctx.subprocess.run(NODE, ['-e', '0'], { signal: ac.signal })
    expect(res.aborted).toBe(false)
    expect(res.exitCode).toBe(0)
  })
})

describe('subprocess: output truncation', () => {
  it('caps captured stdout at maxOutputBytes and reports stdoutTruncated', async () => {
    const ctx = await boot()
    const res = await ctx.subprocess.run(NODE, ["-e", "process.stdout.write('a'.repeat(1000))"], { maxOutputBytes: 100 })
    expect(res.stdout.length).toBe(100)
    expect(res.stdoutTruncated).toBe(true)
    expect(res.stderrTruncated).toBe(false)
  })

  it('does not truncate output at or under the cap', async () => {
    const ctx = await boot()
    const res = await ctx.subprocess.run(NODE, ['-e', "process.stdout.write('abcde')"], { maxOutputBytes: 5 })
    expect(res.stdout).toBe('abcde')
    expect(res.stdoutTruncated).toBe(false)
  })
})

describe('subprocess: working directory', () => {
  it('runs in the configured default cwd', async () => {
    const ctx = await boot({ cwd: process.cwd() })
    const res = await ctx.subprocess.run(NODE, ['-e', 'process.stdout.write(process.cwd())'])
    expect(res.stdout).toBe(process.cwd())
    expect(res.cwd).toBe(process.cwd())
  })

  it('a per-call cwd overrides the bundle default', async () => {
    const ctx = await boot({ cwd: process.cwd() })
    const other = tmpdir()
    const res = await ctx.subprocess.run(NODE, ['-e', 'process.stdout.write(process.cwd())'], { cwd: other })
    // Compare resolved paths: tmpdir() and process.cwd() can differ by trailing slash or symlink.
    expect(realpathSync(res.stdout)).toBe(realpathSync(other))
  })
})
