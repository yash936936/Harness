import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SQLiteWorkspaceStore } from '../src/bundles/app-core/workspaces.js'

const directories: string[] = []
const NOW = Date.UTC(2026, 10, 21, 12, 0, 0)

afterEach(async () => {
  while (directories.length) await rm(directories.pop()!, { recursive: true, force: true })
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'harness-workspace-store-'))
  directories.push(directory)
  const path = join(directory, 'shared.sqlite')
  const store = new SQLiteWorkspaceStore(path, { now: () => NOW })
  return { directory, path, store }
}

function session(overrides: Partial<Parameters<SQLiteWorkspaceStore['createSession']>[0]> = {}) {
  return {
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    taskId: 'task-1',
    sessionId: 'session-1',
    provider: 'vercel',
    state: 'creating' as const,
    ownerId: 'owner-1',
    leaseId: 'lease-1',
    fencingToken: 1,
    createdAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 60_000).toISOString(),
    idempotencyKey: 'create-task-session-1',
    ...overrides,
  }
}

describe('SQLiteWorkspaceStore', () => {
  it('creates task-scoped sessions idempotently and fences state transitions', async () => {
    const { store } = await fixture()
    const input = session()
    const created = await store.createSession(input)
    expect(created).toMatchObject({ workspaceId: 'workspace-1', taskId: 'task-1', state: 'creating', fencingToken: 1 })

    expect(await store.createSession(input)).toEqual(created)
    await expect(store.createSession({ ...input, provider: 'other-provider' }))
      .rejects.toThrow(/idempotency key reused with different session input/)
    await expect(store.createSession({ ...input, workspaceId: 'workspace-2', idempotencyKey: 'another-key' }))
      .rejects.toThrow(/task session already exists/)

    const ready = await store.transitionSession({
      workspaceId: 'workspace-1', ownerId: 'owner-1', leaseId: 'lease-1', fencingToken: 1,
      expectedState: 'creating', nextState: 'ready',
    })
    expect(ready.state).toBe('ready')
    await expect(store.transitionSession({
      workspaceId: 'workspace-1', ownerId: 'owner-1', leaseId: 'lease-1', fencingToken: 2,
      expectedState: 'ready', nextState: 'running',
    })).rejects.toThrow(/stale owner or unexpected session state/)

    const running = await store.transitionSession({
      workspaceId: 'workspace-1', ownerId: 'owner-1', leaseId: 'lease-1', fencingToken: 1,
      expectedState: 'ready', nextState: 'running',
    })
    expect(running.state).toBe('running')
    await expect(store.transitionSession({
      workspaceId: 'workspace-1', ownerId: 'owner-1', leaseId: 'lease-1', fencingToken: 1,
      expectedState: 'running', nextState: 'creating',
    })).rejects.toThrow(/not allowed/)

    expect(await store.getTaskSession('project-1', 'task-1', 'session-1')).toMatchObject({ state: 'running' })
    expect(await store.listSessions('project-1', ['running'])).toHaveLength(1)
    expect(await store.listSessions('project-1', [])).toHaveLength(0)
  })

  it('stores only token digests and enforces capability binding, operations, paths, expiry, and revocation', async () => {
    const { store, path } = await fixture()
    await store.createSession(session())
    await store.transitionSession({
      workspaceId: 'workspace-1', ownerId: 'owner-1', leaseId: 'lease-1', fencingToken: 1,
      expectedState: 'creating', nextState: 'ready',
    })
    const token = 'workspace-capability-secret-token-123'
    await store.recordCapability({
      token,
      capabilityId: 'capability-1',
      projectId: 'project-1',
      taskId: 'task-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      fencingToken: 1,
      operations: ['read', 'write'],
      pathPrefixes: ['src'],
      expiresAt: new Date(NOW + 30_000).toISOString(),
    })

    const databaseBytes = await readFile(path)
    expect(databaseBytes.includes(Buffer.from(token))).toBe(false)
    const authorize = (overrides: Partial<Parameters<SQLiteWorkspaceStore['authorizeCapability']>[0]> = {}) =>
      store.authorizeCapability({
        token, projectId: 'project-1', taskId: 'task-1', sessionId: 'session-1',
        workspaceId: 'workspace-1', operation: 'read', path: 'src/index.ts', now: NOW, ...overrides,
      })

    expect(await authorize()).toBe(true)
    expect(await authorize({ operation: 'write', path: 'src/lib/file.ts' })).toBe(true)
    expect(await authorize({ path: 'src/../.env' })).toBe(false)
    expect(await authorize({ path: 'docs/secret.txt' })).toBe(false)
    expect(await authorize({ operation: 'execute', path: 'src/index.ts' })).toBe(false)
    expect(await authorize({ taskId: 'another-task' })).toBe(false)
    expect(await authorize({ token: 'wrong-capability-token-123456' })).toBe(false)
    expect(await authorize({ now: NOW + 30_000 })).toBe(false)

    await store.revokeCapability('capability-1', 'task completed')
    expect(await authorize()).toBe(false)
    await expect(store.recordCapability({
      token,
      capabilityId: 'capability-1',
      projectId: 'project-1',
      taskId: 'task-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      fencingToken: 1,
      operations: ['read', 'write'],
      pathPrefixes: ['src'],
      expiresAt: new Date(NOW + 30_000).toISOString(),
    })).rejects.toThrow(/revoked capability IDs cannot be reissued/)

    const closingToken = 'closing-capability-secret-token-456'
    await store.recordCapability({
      token: closingToken,
      capabilityId: 'capability-2',
      projectId: 'project-1',
      taskId: 'task-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      fencingToken: 1,
      operations: ['read'],
      pathPrefixes: ['src'],
      expiresAt: new Date(NOW + 30_000).toISOString(),
    })
    const authorizeClosing = () => store.authorizeCapability({
      token: closingToken, projectId: 'project-1', taskId: 'task-1', sessionId: 'session-1',
      workspaceId: 'workspace-1', operation: 'read', path: 'src/index.ts', now: NOW,
    })
    expect(await authorizeClosing()).toBe(true)
    await store.transitionSession({
      workspaceId: 'workspace-1', ownerId: 'owner-1', leaseId: 'lease-1', fencingToken: 1,
      expectedState: 'ready', nextState: 'closing',
    })
    await store.transitionSession({
      workspaceId: 'workspace-1', ownerId: 'owner-1', leaseId: 'lease-1', fencingToken: 1,
      expectedState: 'closing', nextState: 'closed',
    })
    expect(await authorizeClosing()).toBe(false)
  })

  it('rotates the fencing token and revokes prior capabilities when a validated session is adopted', async () => {
    const { store } = await fixture()
    await store.createSession(session())
    await store.transitionSession({
      workspaceId: 'workspace-1', ownerId: 'owner-1', leaseId: 'lease-1', fencingToken: 1,
      expectedState: 'creating', nextState: 'ready',
    })
    const oldCapability = {
      token: 'old-workspace-capability-token-123',
      capabilityId: 'old-capability',
      projectId: 'project-1',
      taskId: 'task-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      fencingToken: 1,
      operations: ['read'] as const,
      pathPrefixes: ['src'],
      expiresAt: new Date(NOW + 30_000).toISOString(),
    }
    await store.recordCapability(oldCapability)
    const authorizeOld = () => store.authorizeCapability({
      token: oldCapability.token, projectId: 'project-1', taskId: 'task-1', sessionId: 'session-1',
      workspaceId: 'workspace-1', operation: 'read', path: 'src/index.ts', now: NOW,
    })
    expect(await authorizeOld()).toBe(true)

    const adopted = await store.adoptSession({
      workspaceId: 'workspace-1',
      expectedOwnerId: 'owner-1',
      expectedLeaseId: 'lease-1',
      expectedFencingToken: 1,
      ownerId: 'owner-2',
      leaseId: 'lease-2',
      fencingToken: 2,
      expiresAt: new Date(NOW + 120_000).toISOString(),
    })
    expect(adopted).toMatchObject({ state: 'ready', leaseId: 'lease-2', fencingToken: 2 })
    expect(await authorizeOld()).toBe(false)

    await expect(store.adoptSession({
      workspaceId: 'workspace-1',
      expectedOwnerId: 'owner-1',
      expectedLeaseId: 'lease-1',
      expectedFencingToken: 1,
      ownerId: 'owner-3',
      leaseId: 'lease-3',
      fencingToken: 3,
      expiresAt: new Date(NOW + 180_000).toISOString(),
    })).rejects.toThrow(/stale session cannot be adopted/)
  })

  it('serializes identical session creation across independent store instances', async () => {
    const { path } = await fixture()
    const left = new SQLiteWorkspaceStore(path, { now: () => NOW })
    const right = new SQLiteWorkspaceStore(path, { now: () => NOW })
    const input = session()
    const [a, b] = await Promise.all([left.createSession(input), right.createSession(input)])
    expect(a.workspaceId).toBe(b.workspaceId)
    expect(await left.listSessions('project-1')).toHaveLength(1)
  })
})
