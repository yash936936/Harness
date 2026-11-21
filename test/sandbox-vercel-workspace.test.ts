import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SQLiteLeaseStore, SQLiteWorkspaceStore, WorkspaceRuntime } from '../src/bundles/app-core/index.js'
import {
  VercelWorkspaceSessionProvider,
  type VercelWorkspaceClient,
  type VercelWorkspaceCommand,
  type VercelWorkspaceSandbox,
  type VercelWorkspaceUser,
} from '../src/bundles/sandbox-vercel/index.js'

const dirs: string[] = []
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

function fakeClient(options: { createUserFails?: boolean; realpath?: (path: string) => string; stdout?: string; stderr?: string; waitMs?: number; killFails?: boolean } = {}) {
  const calls: unknown[] = []
  let sandbox: VercelWorkspaceSandbox | undefined
  let deleted = false
  const user: VercelWorkspaceUser = {
    homeDir: '/home/harness',
    async mkDir(path) { calls.push(['mkdir', path]) },
    async runCommand(request) {
      calls.push(['run', request])
      const command: VercelWorkspaceCommand = {
        async *logs() {
          yield { stream: 'stdout', data: options.stdout ?? 'ok' }
          yield { stream: 'stderr', data: options.stderr ?? 'warn' }
        },
        async wait() {
          if (options.waitMs) await new Promise((resolve) => setTimeout(resolve, options.waitMs))
          return { exitCode: 0 }
        },
        async kill(signal) {
          calls.push(['kill', signal])
          if (options.killFails) throw new Error('kill refused')
        },
      }
      return command
    },
  }
  const client: VercelWorkspaceClient = {
    async create(request) {
      calls.push(['create', request])
      const created: VercelWorkspaceSandbox = {
        name: request.name,
        tags: request.tags,
        async createUser(name) {
          calls.push(['createUser', name])
          if (options.createUserFails) throw new Error('user creation failed')
          return user
        },
        asUser(name) {
          calls.push(['asUser', name])
          return user
        },
        async update(value) { calls.push(['update', value]) },
        async delete(value) { calls.push(['delete', value]); deleted = true },
        fs: {
          async realpath(path) { return options.realpath ? options.realpath(path) : path },
        },
      }
      sandbox = created
      return created
    },
    async get(request) {
      calls.push(['get', request])
      if (!sandbox || deleted) throw Object.assign(new Error('not found'), { status: 404 })
      return sandbox
    },
  }
  return { client, calls }
}

async function setup(
  options: Parameters<typeof fakeClient>[0] = {},
  egress: { status(): Promise<{ projectId: string; consented: boolean }>; assertAllowedHost(host: string): void } = {
    async status() { return { projectId: 'project-1', consented: true } },
    assertAllowedHost(host) { if (host !== 'vercel.com') throw new Error('host not allowlisted') },
  },
) {
  const dir = await mkdtemp(join(tmpdir(), 'vercel-workspace-'))
  dirs.push(dir)
  const databasePath = join(dir, 'workspace.sqlite')
  const now = () => Date.parse('2026-11-21T00:00:00.000Z')
  const leases = new SQLiteLeaseStore(databasePath, { now, maxLeaseTtlMs: 300_000 })
  const sessions = new SQLiteWorkspaceStore(databasePath, { now })
  const fake = fakeClient(options)
  const provider = new VercelWorkspaceSessionProvider({
    client: fake.client,
    egress,
    sessions,
    leases,
    ownerId: 'owner-1',
    now,
  })
  const runtime = new WorkspaceRuntime({
    projectId: 'project-1',
    ownerId: 'owner-1',
    provider,
    sessions,
    leases,
    now,
    maxSessionTtlMs: 300_000,
    maxCommandTimeoutMs: 10_000,
    maxOutputBytes: 1_024,
    maxCapabilityTtlMs: 60_000,
  })
  return { fake, provider, runtime, sessions, leases }
}

describe('Vercel task-scoped workspace provider', () => {
  it('deletes the persistent sandbox when isolated-user initialization fails', async () => {
    const { fake, runtime } = await setup({ createUserFails: true })
    await expect(runtime.open({
      taskId: 'task-create-fail', sessionId: 'session-create-fail', idempotencyKey: 'open-create-fail', ttlMs: 120_000,
    })).rejects.toThrow(/user creation failed/)
    expect(fake.calls).toContainEqual(['delete', { deleteOrphanSnapshots: true }])
    expect(fake.calls.filter((call) => Array.isArray(call) && call[0] === 'delete')).toHaveLength(1)
  })

  it('blocks remote creation without project consent or the exact Vercel host allowlist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vercel-egress-'))
    dirs.push(dir)
    const databasePath = join(dir, 'workspace.sqlite')
    const now = () => Date.parse('2026-11-21T00:00:00.000Z')
    const leases = new SQLiteLeaseStore(databasePath, { now, maxLeaseTtlMs: 300_000 })
    const sessions = new SQLiteWorkspaceStore(databasePath, { now })
    const fake = fakeClient()
    const provider = new VercelWorkspaceSessionProvider({
      client: fake.client,
      egress: {
        async status() { return { projectId: 'project-1', consented: false } },
        assertAllowedHost() { throw new Error('must not be called without consent') },
      },
      sessions,
      leases,
      ownerId: 'owner-1',
      now,
    })
    const runtime = new WorkspaceRuntime({
      projectId: 'project-1', ownerId: 'owner-1', provider, sessions, leases, now,
      maxSessionTtlMs: 300_000, maxCommandTimeoutMs: 10_000, maxOutputBytes: 1_024, maxCapabilityTtlMs: 60_000,
    })

    await expect(runtime.open({ taskId: 'task-egress', sessionId: 'session-egress', idempotencyKey: 'open-egress', ttlMs: 120_000 }))
      .rejects.toThrow(/remote egress consent is required/)
    expect(fake.calls.some((call) => Array.isArray(call) && call[0] === 'create')).toBe(false)
    expect(fake.calls.some((call) => Array.isArray(call) && call[0] === 'get')).toBe(false)
  })

  it('blocks remote creation when the exact Vercel host is not allowlisted', async () => {
    const { fake, runtime } = await setup({}, {
      async status() { return { projectId: 'project-1', consented: true } },
      assertAllowedHost() { throw new Error('Vercel host not allowlisted') },
    })
    await expect(runtime.open({
      taskId: 'task-host', sessionId: 'session-host', idempotencyKey: 'open-host', ttlMs: 120_000,
    })).rejects.toThrow(/Vercel host not allowlisted/)
    expect(fake.calls.some((call) => Array.isArray(call) && call[0] === 'create')).toBe(false)
    expect(fake.calls.some((call) => Array.isArray(call) && call[0] === 'get')).toBe(false)
  })

  it('creates persistent deny-all sandboxes and executes as an isolated user', async () => {
    const { fake, runtime } = await setup()
    const session = await runtime.open({ taskId: 'task-1', sessionId: 'session-1', idempotencyKey: 'open-1', ttlMs: 120_000 })
    expect(session).toMatchObject({ provider: 'vercel', ownerId: 'owner-1', state: 'ready' })

    const capability = await runtime.issueCapability({
      workspaceId: session.workspaceId,
      operations: ['execute'],
      pathPrefixes: ['src'],
      ttlMs: 30_000,
    })
    const result = await runtime.execute(session.workspaceId, capability, {
      command: 'node',
      args: ['--version'],
      cwd: 'src',
      timeoutMs: 2_000,
      maxOutputBytes: 100,
    })

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'ok',
      stderr: 'warn',
      stdoutBytes: 2,
      stderrBytes: 4,
      truncated: false,
      timedOut: false,
      aborted: false,
    })
    const create = fake.calls.find((call) => Array.isArray(call) && call[0] === 'create') as [string, Record<string, unknown>]
    expect(create[1]).toMatchObject({
      name: session.workspaceId,
      persistent: true,
      networkPolicy: 'deny-all',
      keepLastSnapshots: { count: 1, deleteEvicted: true },
    })
    expect(create[1]).not.toHaveProperty('env')
    expect(fake.calls).toContainEqual(['createUser', 'harness'])
    const run = fake.calls.find((call) => Array.isArray(call) && call[0] === 'run') as [string, { cmd: string; args: string[]; cwd: string }]
    expect(run[1]).toMatchObject({ cmd: 'node', args: ['--version'], cwd: '/home/harness/workspace/src' })
    expect(fake.calls).toContainEqual(['update', { networkPolicy: 'deny-all' }])

    const closed = await runtime.close(session.workspaceId, 'test complete')
    expect(closed.confirmed).toBe(true)
    expect(fake.calls).toContainEqual(['delete', { deleteOrphanSnapshots: true }])
  })

  it('kills the remote command when combined stdout and stderr exceed the byte cap', async () => {
    const { fake, runtime } = await setup({ stdout: 'abcdef', stderr: 'warning', waitMs: 20 })
    const session = await runtime.open({ taskId: 'task-output', sessionId: 'session-output', idempotencyKey: 'open-output', ttlMs: 120_000 })
    const capability = await runtime.issueCapability({
      workspaceId: session.workspaceId, operations: ['execute'], pathPrefixes: ['src'], ttlMs: 30_000,
    })
    const result = await runtime.execute(session.workspaceId, capability, {
      command: 'node', args: [], cwd: 'src', timeoutMs: 1_000, maxOutputBytes: 4,
    })
    expect(result).toMatchObject({ stdout: 'abcd\n[output truncated by Vercel workspace provider]', stdoutBytes: 4, stderrBytes: 0, truncated: true })
    expect(fake.calls).toContainEqual(['kill', 'SIGTERM'])
    await runtime.close(session.workspaceId, 'test complete')
  })

  it('reports command timeout only after the remote command is terminated', async () => {
    const { fake, runtime } = await setup({ waitMs: 20 })
    const session = await runtime.open({ taskId: 'task-timeout', sessionId: 'session-timeout', idempotencyKey: 'open-timeout', ttlMs: 120_000 })
    const capability = await runtime.issueCapability({
      workspaceId: session.workspaceId, operations: ['execute'], pathPrefixes: ['src'], ttlMs: 30_000,
    })
    const result = await runtime.execute(session.workspaceId, capability, {
      command: 'node', args: [], cwd: 'src', timeoutMs: 1, maxOutputBytes: 100,
    })
    expect(result).toMatchObject({ exitCode: null, timedOut: true, aborted: false })
    expect(fake.calls).toContainEqual(['kill', 'SIGTERM'])
    await runtime.close(session.workspaceId, 'test complete')
  })

  it('does not report a timeout as handled when remote termination is unconfirmed', async () => {
    const { runtime } = await setup({ waitMs: 20, killFails: true })
    const session = await runtime.open({ taskId: 'task-timeout-fail', sessionId: 'session-timeout-fail', idempotencyKey: 'open-timeout-fail', ttlMs: 120_000 })
    const capability = await runtime.issueCapability({
      workspaceId: session.workspaceId, operations: ['execute'], pathPrefixes: ['src'], ttlMs: 30_000,
    })
    await expect(runtime.execute(session.workspaceId, capability, {
      command: 'node', args: [], cwd: 'src', timeoutMs: 1, maxOutputBytes: 100,
    })).rejects.toThrow(/termination was not confirmed/)
    const unknown = await runtime['sessions'].getSession(session.workspaceId)
    expect(unknown?.state).toBe('unknown')
  })

  it('rechecks capability path prefixes inside the provider, not only in the runtime', async () => {
    const { fake, provider, runtime, sessions } = await setup()
    const session = await runtime.open({ taskId: 'task-2', sessionId: 'session-2', idempotencyKey: 'open-2', ttlMs: 120_000 })
    const capability = await runtime.issueCapability({
      workspaceId: session.workspaceId,
      operations: ['execute'],
      pathPrefixes: ['src'],
      ttlMs: 30_000,
    })
    await sessions.transitionSession({
      workspaceId: session.workspaceId,
      ownerId: session.ownerId,
      leaseId: session.leaseId!,
      fencingToken: session.fencingToken!,
      expectedState: 'ready',
      nextState: 'running',
    })

    await expect(provider.execute(session.workspaceId, capability, {
      command: 'node', args: [], cwd: 'other', timeoutMs: 1_000, maxOutputBytes: 100,
    })).rejects.toThrow(/command capability denied/)
    expect(fake.calls.some((call) => Array.isArray(call) && call[0] === 'run')).toBe(false)
    await runtime.close(session.workspaceId, 'test cleanup')
  })

  it('rechecks durable revocation and rejects a revoked capability inside the provider', async () => {
    const { fake, provider, runtime, sessions } = await setup()
    const session = await runtime.open({ taskId: 'task-revoked', sessionId: 'session-revoked', idempotencyKey: 'open-revoked', ttlMs: 120_000 })
    const capability = await runtime.issueCapability({
      workspaceId: session.workspaceId, operations: ['execute'], pathPrefixes: ['src'], ttlMs: 30_000,
    })
    await runtime.revokeCapability(capability.capabilityId, 'test revocation')
    await sessions.transitionSession({
      workspaceId: session.workspaceId, ownerId: session.ownerId, leaseId: session.leaseId!,
      fencingToken: session.fencingToken!, expectedState: 'ready', nextState: 'running',
    })
    await expect(provider.execute(session.workspaceId, capability, {
      command: 'node', args: [], cwd: 'src', timeoutMs: 1_000, maxOutputBytes: 100,
    })).rejects.toThrow(/command capability denied/)
    expect(fake.calls.some((call) => Array.isArray(call) && call[0] === 'run')).toBe(false)
    await runtime.close(session.workspaceId, 'test cleanup')
  })

  it('rejects a stale lease fence before contacting the Vercel sandbox', async () => {
    const { fake, provider, runtime, sessions, leases } = await setup()
    const session = await runtime.open({ taskId: 'task-fence', sessionId: 'session-fence', idempotencyKey: 'open-fence', ttlMs: 120_000 })
    const capability = await runtime.issueCapability({
      workspaceId: session.workspaceId, operations: ['execute'], pathPrefixes: ['src'], ttlMs: 30_000,
    })
    await sessions.transitionSession({
      workspaceId: session.workspaceId, ownerId: session.ownerId, leaseId: session.leaseId!,
      fencingToken: session.fencingToken!, expectedState: 'ready', nextState: 'running',
    })
    await leases.release(session.leaseId!, session.ownerId, session.fencingToken!)
    const next = await leases.acquire({
      projectId: session.projectId, resourceType: 'workspace', resourceId: session.workspaceId,
      ownerId: 'new-owner', idempotencyKey: 'new-owner-attempt', ttlMs: 120_000,
    })
    expect(next.acquired).toBe(true)
    await expect(provider.execute(session.workspaceId, capability, {
      command: 'node', args: [], cwd: 'src', timeoutMs: 1_000, maxOutputBytes: 100,
    })).rejects.toThrow(/lease fencing token is stale/)
    expect(fake.calls.some((call) => Array.isArray(call) && call[0] === 'run')).toBe(false)
  })

  it('rejects a sandbox whose durable scope tags do not match the SQLite session', async () => {
    const { fake, provider, runtime, sessions } = await setup()
    const session = await runtime.open({ taskId: 'task-3', sessionId: 'session-3', idempotencyKey: 'open-3', ttlMs: 120_000 })
    const capability = await runtime.issueCapability({
      workspaceId: session.workspaceId,
      operations: ['execute'],
      pathPrefixes: ['src'],
      ttlMs: 30_000,
    })
    await sessions.transitionSession({
      workspaceId: session.workspaceId,
      ownerId: session.ownerId,
      leaseId: session.leaseId!,
      fencingToken: session.fencingToken!,
      expectedState: 'ready',
      nextState: 'running',
    })
    const create = fake.calls.find((call) => Array.isArray(call) && call[0] === 'create') as [string, { name: string; tags: Record<string, string> }]
    create[1].tags.harness_scope = 'wrong-scope'

    await expect(provider.execute(session.workspaceId, capability, {
      command: 'node', args: [], cwd: 'src', timeoutMs: 1_000, maxOutputBytes: 100,
    })).rejects.toThrow(/remote sandbox identity/)
    expect(fake.calls.some((call) => Array.isArray(call) && call[0] === 'run')).toBe(false)
    await runtime.close(session.workspaceId, 'test cleanup')
    expect(fake.calls.some((call) => Array.isArray(call) && call[0] === 'delete')).toBe(false)
  })

  it('rejects a real path that escapes the isolated workspace root', async () => {
    const { fake, provider, runtime, sessions } = await setup({
      realpath: (path) => path.endsWith('/src') ? '/etc' : path,
    })
    const session = await runtime.open({ taskId: 'task-4', sessionId: 'session-4', idempotencyKey: 'open-4', ttlMs: 120_000 })
    const capability = await runtime.issueCapability({
      workspaceId: session.workspaceId,
      operations: ['execute'],
      pathPrefixes: ['src'],
      ttlMs: 30_000,
    })
    await sessions.transitionSession({
      workspaceId: session.workspaceId,
      ownerId: session.ownerId,
      leaseId: session.leaseId!,
      fencingToken: session.fencingToken!,
      expectedState: 'ready',
      nextState: 'running',
    })

    await expect(provider.execute(session.workspaceId, capability, {
      command: 'node', args: [], cwd: 'src', timeoutMs: 1_000, maxOutputBytes: 100,
    })).rejects.toThrow(/resolves outside the workspace/)
    expect(fake.calls.some((call) => Array.isArray(call) && call[0] === 'run')).toBe(false)
    await runtime.close(session.workspaceId, 'test cleanup')
  })
})
