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
  it('uses argv, deny-all networking, non-persistent sandboxes and confirms deletion', async () => {
    const f = fake()
    const ctx = await boot()
    ctx.sandbox.register(new VercelSandboxProvider({ client: f.client }))
    const result = await ctx.sandbox.run({ command: ['npm', 'test', '--', 'a b'], timeoutMs: 12_000 })
    expect(result).toMatchObject({ provider: 'vercel', leaseId: 'sbx-test-1', exitCode: 7, stdout: 'out', stderr: 'err', released: true })
    expect(f.calls[0]).toEqual(['create', { persistent: false, networkPolicy: 'deny-all', timeout: 12_000 }])
    expect(f.calls[1]).toEqual(['run', {
      cmd: 'npm', args: ['test', '--', 'a b'],
    }])
    expect(f.calls[2]).toEqual(['delete'])
  })

  it('blocks before contacting Vercel without project consent', async () => {
    const f = fake()
    const ctx = await boot(['vercel.com'], false)
    ctx.sandbox.register(new VercelSandboxProvider({ client: f.client }))
    await expect(ctx.sandbox.run({ command: ['true'] })).rejects.toMatchObject({ kind: 'consent' })
    expect(f.calls).toEqual([])
  })

  it('blocks before contacting Vercel when the API host is not allowlisted', async () => {
    const f = fake()
    const ctx = await boot(['other.example'])
    ctx.sandbox.register(new VercelSandboxProvider({ client: f.client }))
    await expect(ctx.sandbox.run({ command: ['true'] })).rejects.toMatchObject({ name: 'EgressError' })
    expect(f.calls).toEqual([])
  })

  it('reports deletion failure as released false', async () => {
    const f = fake({ deleteFails: true })
    const ctx = await boot()
    ctx.sandbox.register(new VercelSandboxProvider({ client: f.client }))
    const result = await ctx.sandbox.run({ command: ['true'] })
    expect(result.released).toBe(false)
    expect(result.releaseNote).toContain('delete refused')
  })

  it('still attempts deletion when command execution fails', async () => {
    const f = fake({ runFails: new Error('command timed out') })
    const ctx = await boot()
    ctx.sandbox.register(new VercelSandboxProvider({ client: f.client }))
    const result = await ctx.sandbox.run({ command: ['npm', 'test'] })
    expect(result.timedOut).toBe(true)
    expect(result.stderr).toContain('command timed out')
    expect(result.released).toBe(true)
    expect(f.calls.at(-1)).toEqual(['delete'])
  })

  it('rejects invalid argv and timeout values', async () => {
    const f = fake()
    const ctx = await boot()
    ctx.sandbox.register(new VercelSandboxProvider({ client: f.client }))
    await expect(ctx.sandbox.run({ command: [''] })).rejects.toMatchObject({ kind: 'config' })
    await expect(ctx.sandbox.run({ command: ['echo', 'bad\0arg'] })).rejects.toMatchObject({ kind: 'config' })
    await expect(ctx.sandbox.run({ command: ['true'], timeoutMs: 0 })).rejects.toMatchObject({ kind: 'config' })
    expect(f.calls).toEqual([])
  })

  it('rejects invalid provider timeout configuration', () => {
    expect(() => new VercelSandboxProvider({ sandboxTimeoutMs: 0 })).toThrow(/sandboxTimeoutMs/)
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
    ctx.sandbox.register(new VercelSandboxProvider({ client }))
    const controller = new AbortController()
    const running = ctx.sandbox.run({ command: ['npm', 'test'], signal: controller.signal })
    await began
    controller.abort(new Error('test cancellation'))
    await expect(running).rejects.toThrow('test cancellation')
    expect(deleted).toBe(true)
  })

})
