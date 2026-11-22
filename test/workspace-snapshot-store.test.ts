import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SQLiteLeaseStore } from '../src/bundles/app-core/budgets.js'
import { SQLiteWorkspaceStore } from '../src/bundles/app-core/workspaces.js'
import { SQLiteWorkspaceSnapshotStore } from '../src/bundles/app-core/workspace-snapshots.js'
import { workspaceManifestSha256 } from '../src/bundles/app-core/workspace-transfer.js'
import type { WorkspaceSnapshotManifest, WorkspaceTransferLimits } from '../src/architecture/contracts.js'

const dirs: string[] = []
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

const limits: WorkspaceTransferLimits = {
  maxFiles: 10,
  maxEntries: 20,
  maxFileBytes: 1_024,
  maxTotalBytes: 4_096,
  chunkBytes: 256,
}

function manifest(snapshotId = 'snapshot-1', text = 'hello', createdAt = '2026-11-21T00:00:00.000Z'): WorkspaceSnapshotManifest {
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex')
  const base = {
    formatVersion: 1 as const,
    snapshotId,
    projectId: 'project-1',
    taskId: 'task-1',
    entries: [{ path: 'src', kind: 'directory' as const, sizeBytes: 0 as const }, {
      path: 'src/index.txt', kind: 'file' as const, sizeBytes: Buffer.byteLength(text), sha256,
    }],
    totalBytes: Buffer.byteLength(text),
    createdAt,
  }
  return { ...base, manifestSha256: workspaceManifestSha256(base) }
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'workspace-snapshot-store-'))
  dirs.push(dir)
  const databasePath = join(dir, 'workspace.sqlite')
  const clock = { value: Date.parse('2026-11-21T00:00:00.000Z') }
  const now = () => clock.value
  const leases = new SQLiteLeaseStore(databasePath, { now, maxLeaseTtlMs: 120_000 })
  const sessions = new SQLiteWorkspaceStore(databasePath, { now })
  const snapshots = new SQLiteWorkspaceSnapshotStore(databasePath, { now })
  const decision = await leases.acquire({
    projectId: 'project-1',
    resourceType: 'workspace',
    resourceId: 'workspace-1',
    ownerId: 'owner-1',
    idempotencyKey: 'lease-open-1',
    ttlMs: 60_000,
  })
  if (!decision.acquired) throw new Error('test lease was not acquired')
  await sessions.createSession({
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    taskId: 'task-1',
    sessionId: 'session-1',
    provider: 'vercel',
    ownerId: 'owner-1',
    state: 'creating',
    leaseId: decision.lease.leaseId,
    fencingToken: decision.lease.fencingToken,
    createdAt: new Date(clock.value).toISOString(),
    expiresAt: decision.lease.expiresAt,
    idempotencyKey: 'workspace-open-1',
  })
  await sessions.transitionSession({
    workspaceId: 'workspace-1',
    ownerId: 'owner-1',
    leaseId: decision.lease.leaseId,
    fencingToken: decision.lease.fencingToken,
    expectedState: 'creating',
    nextState: 'ready',
  })
  return { databasePath, clock, leases, sessions, snapshots, lease: decision.lease }
}

describe('SQLite workspace snapshot metadata', () => {
  it('persists a validated provider snapshot manifest and makes identical retries idempotent', async () => {
    const state = await setup()
    const value = manifest()
    const input = {
      workspaceId: 'workspace-1',
      ownerId: 'owner-1',
      leaseId: state.lease.leaseId,
      fencingToken: state.lease.fencingToken,
      manifest: value,
      limits,
    }
    await state.snapshots.save(input)
    await state.snapshots.save(input)
    const reopened = new SQLiteWorkspaceSnapshotStore(state.databasePath, { now: () => state.clock.value })
    await expect(reopened.get('workspace-1', 'snapshot-1')).resolves.toEqual(value)
    await expect(reopened.list('workspace-1')).resolves.toEqual([value])
  })

  it('rejects snapshot ID reuse with different manifest bytes', async () => {
    const state = await setup()
    await state.snapshots.save({
      workspaceId: 'workspace-1',
      ownerId: 'owner-1',
      leaseId: state.lease.leaseId,
      fencingToken: state.lease.fencingToken,
      manifest: manifest(),
      limits,
    })
    await expect(state.snapshots.save({
      workspaceId: 'workspace-1',
      ownerId: 'owner-1',
      leaseId: state.lease.leaseId,
      fencingToken: state.lease.fencingToken,
      manifest: manifest('snapshot-1', 'changed'),
      limits,
    })).rejects.toThrow(/already exists with different manifest or fence/)
  })

  it('rejects manifests outside the current workspace fence and blocks stale-owner deletion', async () => {
    const state = await setup()
    const value = manifest()
    await expect(state.snapshots.save({
      workspaceId: 'workspace-1',
      ownerId: 'owner-2',
      leaseId: state.lease.leaseId,
      fencingToken: state.lease.fencingToken,
      manifest: value,
      limits,
    })).rejects.toThrow(/current ready workspace fence/)

    await state.snapshots.save({
      workspaceId: 'workspace-1',
      ownerId: 'owner-1',
      leaseId: state.lease.leaseId,
      fencingToken: state.lease.fencingToken,
      manifest: value,
      limits,
    })
    await expect(state.snapshots.delete({
      workspaceId: 'workspace-1',
      snapshotId: 'snapshot-1',
      ownerId: 'owner-2',
      leaseId: state.lease.leaseId,
      fencingToken: state.lease.fencingToken,
    })).rejects.toThrow(/stale owner/)
    await expect(state.snapshots.delete({
      workspaceId: 'workspace-1',
      snapshotId: 'snapshot-1',
      ownerId: 'owner-1',
      leaseId: state.lease.leaseId,
      fencingToken: state.lease.fencingToken,
    })).resolves.toBe(true)
    await expect(state.snapshots.get('workspace-1', 'snapshot-1')).resolves.toBeUndefined()
  })

  it('rejects invalid manifests and out-of-range list limits before persistence', async () => {
    const state = await setup()
    const invalid = { ...manifest(), manifestSha256: '0'.repeat(64) }
    await expect(state.snapshots.save({
      workspaceId: 'workspace-1',
      ownerId: 'owner-1',
      leaseId: state.lease.leaseId,
      fencingToken: state.lease.fencingToken,
      manifest: invalid,
      limits,
    })).rejects.toThrow(/SHA-256 mismatch/)
    await expect(state.snapshots.list('workspace-1', 101)).rejects.toThrow(/list limit/)
  })
})
