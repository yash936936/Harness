import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  CreateWorkspaceSessionInput,
  WorkspaceCapability,
  WorkspaceCommand,
  WorkspaceCommandResult,
  WorkspaceSession,
  WorkspaceSessionProvider,
} from '../src/architecture/contracts.js'
import { SQLiteLeaseStore, SQLiteWorkspaceStore, WorkspaceRuntime } from '../src/bundles/app-core/index.js'

const NOW = Date.UTC(2026, 10, 21, 13, 0, 0)
const directories: string[] = []

afterEach(async () => {
  while (directories.length) await rm(directories.pop()!, { recursive: true, force: true })
})

class FakeWorkspaceProvider implements WorkspaceSessionProvider {
  readonly name = 'fake-workspace'
  createCalls = 0
  closeCalls = 0
  readonly revoked: string[] = []
  closeConfirmed = true
  createFailure?: Error

  async create(input: CreateWorkspaceSessionInput): Promise<WorkspaceSession> {
    this.createCalls += 1
    if (this.createFailure) throw this.createFailure
    return {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      sessionId: input.sessionId,
      provider: this.name,
      ownerId: input.ownerId,
      state: 'ready',
      leaseId: input.leaseId,
      fencingToken: input.fencingToken,
      createdAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + input.ttlMs).toISOString(),
    }
  }

  async issueCapability(input: {
    readonly workspaceId: string
    readonly projectId: string
    readonly fencingToken: number
    readonly taskId: string
    readonly sessionId: string
    readonly operations: readonly ('list' | 'read' | 'write' | 'execute' | 'collect')[]
    readonly pathPrefixes: readonly string[]
    readonly ttlMs: number
  }): Promise<WorkspaceCapability> {
    return {
      token: 'runtime-capability-token-secret-123',
      capabilityId: 'runtime-capability-1',
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      sessionId: input.sessionId,
      fencingToken: input.fencingToken,
      operations: input.operations,
      pathPrefixes: input.pathPrefixes,
      expiresAt: new Date(NOW + input.ttlMs).toISOString(),
    }
  }

  async execute(_workspaceId: string, _capability: WorkspaceCapability, _command: WorkspaceCommand): Promise<WorkspaceCommandResult> {
    return { exitCode: 0, stdout: 'ok', stderr: '', stdoutBytes: 2, stderrBytes: 0, truncated: false, timedOut: false, aborted: false }
  }

  async revoke(capabilityId: string): Promise<void> {
    this.revoked.push(capabilityId)
  }

  async close(): Promise<{ confirmed: boolean }> {
    this.closeCalls += 1
    return { confirmed: this.closeConfirmed }
  }
}

async function fixture(provider = new FakeWorkspaceProvider()) {
  const directory = await mkdtemp(join(tmpdir(), 'harness-workspace-runtime-'))
  directories.push(directory)
  const databasePath = join(directory, 'shared.sqlite')
  const leases = new SQLiteLeaseStore(databasePath, { now: () => NOW })
  const sessions = new SQLiteWorkspaceStore(databasePath, { now: () => NOW })
  const runtime = new WorkspaceRuntime({
    projectId: 'project-runtime',
    ownerId: 'owner-runtime',
    leases,
    sessions,
    provider,
    now: () => NOW,
  })
  return { provider, leases, sessions, runtime }
}

const openInput = { taskId: 'task-runtime', sessionId: 'session-runtime', idempotencyKey: 'open-runtime-1', ttlMs: 60_000 }

describe('WorkspaceRuntime', () => {
  it('creates an idempotent task session, issues a fenced capability, executes, revokes, and closes', async () => {
    const { provider, leases, sessions, runtime } = await fixture()
    const session = await runtime.open(openInput)
    expect(session).toMatchObject({ state: 'ready', ownerId: 'owner-runtime', provider: provider.name, fencingToken: 1 })
    expect(provider.createCalls).toBe(1)
    expect(await runtime.open(openInput)).toEqual(session)
    expect(provider.createCalls).toBe(1)

    const capability = await runtime.issueCapability({
      workspaceId: session.workspaceId,
      operations: ['execute'],
      pathPrefixes: ['src'],
      ttlMs: 30_000,
    })
    expect(capability.fencingToken).toBe(1)
    const result = await runtime.execute(session.workspaceId, capability, {
      command: 'node',
      args: ['--version'],
      cwd: 'src',
      timeoutMs: 5_000,
      maxOutputBytes: 1_024,
    })
    expect(result).toMatchObject({ exitCode: 0, stdout: 'ok' })
    expect((await sessions.getSession(session.workspaceId))?.state).toBe('ready')

    await runtime.revokeCapability(capability.capabilityId, 'task complete')
    expect(provider.revoked).toContain(capability.capabilityId)
    await expect(runtime.execute(session.workspaceId, capability, {
      command: 'node', args: [], cwd: 'src', timeoutMs: 5_000, maxOutputBytes: 1_024,
    })).rejects.toThrow(/stale or mis-scoped capability|command capability denied/)

    const closed = await runtime.close(session.workspaceId, 'task complete')
    expect(closed.confirmed).toBe(true)
    expect((await sessions.getSession(session.workspaceId))?.state).toBe('closed')
    expect(await leases.isCurrent(session.leaseId!, 'owner-runtime', session.fencingToken!)).toBe(false)
  })

  it('keeps the lease when provider cleanup is not confirmed', async () => {
    const provider = new FakeWorkspaceProvider()
    provider.closeConfirmed = false
    const { leases, sessions, runtime } = await fixture(provider)
    const session = await runtime.open(openInput)
    const result = await runtime.close(session.workspaceId, 'test cleanup')
    expect(result.confirmed).toBe(false)
    expect((await sessions.getSession(session.workspaceId))?.state).toBe('unknown')
    expect(await leases.isCurrent(session.leaseId!, 'owner-runtime', session.fencingToken!)).toBe(true)
  })

  it('marks failed creation and releases the lease only after confirmed cleanup', async () => {
    const provider = new FakeWorkspaceProvider()
    provider.createFailure = new Error('provider create failed')
    const { leases, sessions, runtime } = await fixture(provider)
    await expect(runtime.open(openInput)).rejects.toThrow('provider create failed')
    const session = await sessions.getTaskSession('project-runtime', 'task-runtime', 'session-runtime')
    expect(session?.state).toBe('failed')
    expect(await leases.isCurrent(session!.leaseId!, 'owner-runtime', session!.fencingToken!)).toBe(false)
    expect(provider.closeCalls).toBe(1)
  })

  it('fails closed when the provider returns a capability with a different fence', async () => {
    const provider = new FakeWorkspaceProvider()
    const original = provider.issueCapability.bind(provider)
    provider.issueCapability = async (input) => ({ ...(await original(input)), fencingToken: input.fencingToken + 1 })
    const { runtime } = await fixture(provider)
    const session = await runtime.open(openInput)
    await expect(runtime.issueCapability({
      workspaceId: session.workspaceId, operations: ['execute'], pathPrefixes: ['src'], ttlMs: 30_000,
    })).rejects.toThrow(/capability outside the requested scope/)
    expect(provider.revoked).toContain('runtime-capability-1')
  })
})
