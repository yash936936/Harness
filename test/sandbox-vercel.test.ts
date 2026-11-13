import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { Sandbox } from '../src/bundles/sandbox/index.js'
import { VercelSandboxProvider, type VercelSandboxClient, type VercelSandboxHandle } from '../src/bundles/sandbox-vercel/index.js'

function fake(over: { deleteFails?: boolean; createFails?: boolean; runFails?: Error } = {}) {
  const calls: unknown[] = []
  const handle: VercelSandboxHandle = {
    name: 'sbx-test-1',
    async runCommand(options) {
      calls.push(['run', options])
      if (over.runFails) throw over.runFails
      return { exitCode: 7, stdout: async () => 'out', stderr: async () => 'err' }
    },
    async delete() {
      calls.push(['delete'])
      if (over.deleteFails) throw new Error('delete refused')
    },
  }
  const client: VercelSandboxClient = {
    async create(options) {
      calls.push(['create', options])
      if (over.createFails) throw new Error('control plane unavailable')
      return handle
    },
  }
  return { client, calls }
}

async function boot(hosts: string[] = ['vercel.com'], consent = true) {
  const ctx = new Context()
  await ctx.plugin(EgressPolicy, { projectId: 'test-project', allowedHosts: hosts })
  if (consent) await ctx.egress.grantConsent()
  await ctx.plugin(Sandbox)
  return ctx
}

describe('Vercel Sandbox provider (D-118)', () => {
  it('waits for a late create to settle and confirms deletion after cancellation', async () => {
    const ctx = await boot()
    let resolveCreate!: (handle: VercelSandboxHandle) => void
    let deleted = 0
    const client: VercelSandboxClient = { create: async () => new Promise<VercelSandboxHandle>((resolve) => { resolveCreate = resolve }) }
    const provider = new VercelSandboxProvider({ client })
    const controller = new AbortController()
    const running = provider.run({ command: ['true'], signal: controller.signal })
    await new Promise<void>((resolve) => setImmediate(resolve))
    controller.abort(new Error('cancelled by test'))
    resolveCreate({ name: 'late-lease', async runCommand() { throw new Error('must not run') }, async delete() { deleted++ } })
    await expect(running).rejects.toThrow('cancelled by test')
    expect(deleted).toBe(1)
    await ctx.fiber.dispose()
  })

  it('reports late-delete failure instead of swallowing a leaked lease', async () => {
    let resolveCreate!: (handle: VercelSandboxHandle) => void
    const client: VercelSandboxClient = { create: async () => new Promise<VercelSandboxHandle>((resolve) => { resolveCreate = resolve }) }
    const provider = new VercelSandboxProvider({ client })
    const controller = new AbortController()
    const running = provider.run({ command: ['true'], signal: controller.signal })
    await new Promise<void>((resolve) => setImmediate(resolve))
    controller.abort(new Error('cancelled by test'))
    resolveCreate({ name: 'late-lease', async runCommand() { throw new Error('must not run') }, async delete() { throw new Error('late delete refused') } })
    await expect(running).rejects.toThrow(/deletion was not confirmed.*late delete refused/)
  })

  it('rejects timer values above the Node timeout maximum', async () => {
    const provider = new VercelSandboxProvider({ client: fake().client })
    await expect(provider.run({ command: ['true'], timeoutMs: 2_147_483_648 })).rejects.toMatchObject({ kind: 'config' })
  })

  it('uses argv, deny-all networking, non-persistent sandboxes and confirms deletion', async () => {
    const f = fake()
    const ctx = await boot()
    ctx.sandbox.register(new VercelSandboxProvider({ client: f.client }), { default: true })
    const result = await ctx.sandbox.run({ command: ['npm', 'test', '--', 'a b'], cwd: '/vercel/sandbox/project', timeoutMs: 12_000 })
    expect(result).toMatchObject({ provider: 'vercel', leaseId: 'sbx-test-1', exitCode: 7, stdout: 'out', stderr: 'err', released: true })
    expect(f.calls[0]).toEqual(['create', { persistent: false, networkPolicy: 'deny-all', timeout: 12_000 }])
    const runCall = f.calls[1] as [
      'run',
      Parameters<VercelSandboxHandle['runCommand']>[0],
    ]
    expect(runCall[0]).toBe('run')
    expect(runCall[1]).toMatchObject({
      cmd: 'npm',
      args: ['test', '--', 'a b'],
      cwd: '/vercel/sandbox/project',
    })
    expect(runCall[1].signal).toBeInstanceOf(AbortSignal)
    expect(f.calls[2]).toEqual(['delete'])
  })

  it('blocks before contacting Vercel without project consent', async () => {
    const f = fake()
    const ctx = await boot(['vercel.com'], false)
    ctx.sandbox.register(new VercelSandboxProvider({ client: f.client }), { default: true })
    await expect(ctx.sandbox.run({ command: ['true'] })).rejects.toMatchObject({ kind: 'consent' })
    expect(f.calls).toEqual([])
  })

  it('blocks before contacting Vercel when the API host is not allowlisted', async () => {
    const f = fake()
    const ctx = await boot(['other.example'])
    ctx.sandbox.register(new VercelSandboxProvider({ client: f.client }), { default: true })
    await expect(ctx.sandbox.run({ command: ['true'] })).rejects.toMatchObject({ name: 'EgressError' })
    expect(f.calls).toEqual([])
  })

  it('reports deletion failure as released false', async () => {
    const f = fake({ deleteFails: true })
    const ctx = await boot()
    ctx.sandbox.register(new VercelSandboxProvider({ client: f.client }), { default: true })
    const result = await ctx.sandbox.run({ command: ['true'] })
    expect(result.released).toBe(false)
    expect(result.releaseNote).toContain('delete refused')
  })

  it('still attempts deletion when command execution fails', async () => {
    const f = fake({ runFails: new Error('command timed out') })
    const ctx = await boot()
    ctx.sandbox.register(new VercelSandboxProvider({ client: f.client }), { default: true })
    const result = await ctx.sandbox.run({ command: ['npm', 'test'] })
    expect(result.timedOut).toBe(true)
    expect(result.stderr).toContain('command timed out')
    expect(result.released).toBe(true)
    expect(f.calls.at(-1)).toEqual(['delete'])
  })

  it('enforces an independent command deadline and deletes the lease', async () => {
    let deleted = false
    const client: VercelSandboxClient = {
      async create() {
        return {
          name: 'sbx-deadline',
          async runCommand() { return new Promise<never>(() => {}) },
          async delete() { deleted = true },
        }
      },
    }
    const ctx = await boot()
    ctx.sandbox.register(new VercelSandboxProvider({ client }), { default: true })
    const result = await ctx.sandbox.run({ command: ['sleep', 'forever'], timeoutMs: 20 })
    expect(result).toMatchObject({ timedOut: true, released: true, exitCode: null })
    expect(result.stderr).toContain('timed out after 20ms')
    expect(deleted).toBe(true)
  })

  it('rejects invalid argv and timeout values', async () => {
    const f = fake()
    const ctx = await boot()
    ctx.sandbox.register(new VercelSandboxProvider({ client: f.client }), { default: true })
    await expect(ctx.sandbox.run({ command: [''] })).rejects.toMatchObject({ kind: 'config' })
    await expect(ctx.sandbox.run({ command: ['echo', 'bad\0arg'] })).rejects.toMatchObject({ kind: 'config' })
    await expect(ctx.sandbox.run({ command: ['true'], timeoutMs: 0 })).rejects.toMatchObject({ kind: 'config' })
    expect(f.calls).toEqual([])
  })

  it('rejects invalid provider timeout configuration', () => {
    expect(() => new VercelSandboxProvider({ sandboxTimeoutMs: 0 })).toThrow(/sandboxTimeoutMs/)
  })

  it('bounds stdout and stderr independently', async () => {
    const client: VercelSandboxClient = {
      async create() {
        return {
          name: 'sbx-output',
          async runCommand() {
            return { exitCode: 0, stdout: async () => 'abcdef', stderr: async () => 'uvwxyz' }
          },
          async delete() {},
        }
      },
    }
    const ctx = await boot()
    ctx.sandbox.register(new VercelSandboxProvider({ client, maxOutputBytes: 3 }), { default: true })
    const result = await ctx.sandbox.run({ command: ['true'] })
    expect(result.stdout).toBe('abc\n[output truncated by Vercel provider]')
    expect(result.stderr).toBe('uvw\n[output truncated by Vercel provider]')
  })

  it('deletes the remote sandbox when a command is cancelled', async () => {
    let started!: () => void
    const began = new Promise<void>((resolve) => { started = resolve })
    let deleted = false
    const client: VercelSandboxClient = {
      async create() {
        return {
          name: 'sbx-cancel',
          async runCommand() {
            started()
            return new Promise<never>(() => {})
          },
          async delete() { deleted = true },
        }
      },
    }
    const ctx = await boot()
    ctx.sandbox.register(new VercelSandboxProvider({ client }), { default: true })
    const controller = new AbortController()
    const running = ctx.sandbox.run({ command: ['npm', 'test'], signal: controller.signal })
    await began
    controller.abort(new Error('test cancellation'))
    await expect(running).rejects.toThrow('test cancellation')
    expect(deleted).toBe(true)
  })

})
