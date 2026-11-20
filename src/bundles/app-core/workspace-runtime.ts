import { createHash, randomUUID } from 'node:crypto'
import { SQLiteLeaseStore } from './budgets.js'
import { SQLiteWorkspaceStore } from './workspaces.js'
import type {
  LeaseStore,
  WorkspaceCapability,
  WorkspaceCommand,
  WorkspaceCommandResult,
  WorkspaceSession,
  WorkspaceSessionProvider,
  WorkspaceSessionStore,
  WorkspaceOperation,
  CreateWorkspaceSessionInput,
} from '../../architecture/contracts.js'

export interface OpenWorkspaceInput {
  readonly taskId: string
  readonly sessionId: string
  readonly idempotencyKey: string
  readonly ttlMs: number
  readonly signal?: AbortSignal
}

export interface WorkspaceRuntimeOptions {
  readonly projectId: string
  readonly ownerId: string
  readonly leases: LeaseStore
  readonly sessions: WorkspaceSessionStore
  readonly provider: WorkspaceSessionProvider
  readonly now?: () => number
  readonly maxSessionTtlMs?: number
  readonly maxCommandTimeoutMs?: number
  readonly maxOutputBytes?: number
  readonly maxCapabilityTtlMs?: number
}

export interface IssueWorkspaceCapabilityInput {
  readonly workspaceId: string
  readonly operations: readonly WorkspaceOperation[]
  readonly pathPrefixes: readonly string[]
  readonly ttlMs: number
}

export interface SQLiteWorkspaceRuntimeOptions extends Omit<WorkspaceRuntimeOptions, 'leases' | 'sessions'> {
  readonly databasePath: string
  readonly maxLeaseTtlMs?: number
}

/** Construct the lease and session stores over the same per-project SQLite database. */
export function createSQLiteWorkspaceRuntime(options: SQLiteWorkspaceRuntimeOptions): WorkspaceRuntime {
  const databasePath = required('databasePath', options.databasePath, 4_096)
  const leases = new SQLiteLeaseStore(databasePath, {
    now: options.now,
    maxLeaseTtlMs: options.maxLeaseTtlMs ?? options.maxSessionTtlMs,
  })
  const sessions = new SQLiteWorkspaceStore(databasePath, { now: options.now })
  return new WorkspaceRuntime({
    projectId: options.projectId,
    ownerId: options.ownerId,
    provider: options.provider,
    now: options.now,
    maxSessionTtlMs: options.maxSessionTtlMs,
    maxCommandTimeoutMs: options.maxCommandTimeoutMs,
    maxOutputBytes: options.maxOutputBytes,
    maxCapabilityTtlMs: options.maxCapabilityTtlMs,
    leases,
    sessions,
  })
}

function required(name: string, value: unknown, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value !== value.trim()) throw new TypeError(`workspace runtime: invalid ${name}`)
  return value
}

function workspaceIdFor(projectId: string, taskId: string, sessionId: string): string {
  const digest = createHash('sha256').update(`${projectId}\0${taskId}\0${sessionId}`, 'utf8').digest('hex').slice(0, 32)
  return `ws_${digest}`
}

function isoTimestamp(name: string, value: string): number {
  const ms = Date.parse(value)
  if (!Number.isSafeInteger(ms) || new Date(ms).toISOString() !== value) throw new TypeError(`workspace runtime: provider returned invalid ${name}`)
  return ms
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const a = [...left].sort()
  const b = [...right].sort()
  return a.every((value, index) => value === b[index])
}

function validateCommand(command: WorkspaceCommand, maxTimeoutMs: number, maxOutputBytes: number): void {
  required('command', command.command, 512)
  if (command.command.includes('\0')) throw new TypeError('workspace runtime: command contains a NUL byte')
  if (!Array.isArray(command.args) || command.args.length > 256 || command.args.some((arg) => typeof arg !== 'string' || arg.length > 8_192 || arg.includes('\0'))) {
    throw new TypeError('workspace runtime: invalid command arguments')
  }
  if (!Number.isSafeInteger(command.timeoutMs) || command.timeoutMs < 1 || command.timeoutMs > maxTimeoutMs) {
    throw new RangeError('workspace runtime: command timeout exceeds configured bounds')
  }
  if (!Number.isSafeInteger(command.maxOutputBytes) || command.maxOutputBytes < 1 || command.maxOutputBytes > maxOutputBytes) {
    throw new RangeError('workspace runtime: command output limit exceeds configured bounds')
  }
  required('command cwd', command.cwd, 1_024)
}

function validateResult(result: WorkspaceCommandResult, maxOutputBytes: number): void {
  if (result.exitCode !== null && !Number.isSafeInteger(result.exitCode)) throw new TypeError('workspace runtime: provider returned invalid exitCode')
  if (typeof result.stdout !== 'string' || typeof result.stderr !== 'string') throw new TypeError('workspace runtime: provider returned invalid output')
  for (const [name, value] of [['stdoutBytes', result.stdoutBytes], ['stderrBytes', result.stderrBytes]] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maxOutputBytes) throw new RangeError(`workspace runtime: provider returned invalid ${name}`)
  }
  if (result.stdoutBytes + result.stderrBytes > maxOutputBytes) throw new RangeError('workspace runtime: provider exceeded the combined output limit')
  if (typeof result.truncated !== 'boolean' || typeof result.timedOut !== 'boolean' || typeof result.aborted !== 'boolean') {
    throw new TypeError('workspace runtime: provider returned invalid result flags')
  }
}

/**
 * Backend-neutral task workspace lifecycle and capability gate. Providers must
 * independently enforce the fencing token and capability scope; this runtime
 * checks the shared SQLite lease and metadata store before every operation.
 */
export class WorkspaceRuntime {
  private readonly projectId: string
  private readonly ownerId: string
  private readonly leases: LeaseStore
  private readonly sessions: WorkspaceSessionStore
  private readonly provider: WorkspaceSessionProvider
  private readonly now: () => number
  private readonly maxSessionTtlMs: number
  private readonly maxCommandTimeoutMs: number
  private readonly maxOutputBytes: number
  private readonly maxCapabilityTtlMs: number

  constructor(options: WorkspaceRuntimeOptions) {
    this.projectId = required('projectId', options.projectId)
    this.ownerId = required('ownerId', options.ownerId)
    this.leases = options.leases
    this.sessions = options.sessions
    this.provider = options.provider
    required('provider name', this.provider.name, 128)
    this.now = options.now ?? Date.now
    this.maxSessionTtlMs = options.maxSessionTtlMs ?? 24 * 60 * 60 * 1_000
    this.maxCommandTimeoutMs = options.maxCommandTimeoutMs ?? 60_000
    this.maxOutputBytes = options.maxOutputBytes ?? 1_000_000
    this.maxCapabilityTtlMs = options.maxCapabilityTtlMs ?? Math.min(60 * 60 * 1_000, this.maxSessionTtlMs)
    if (!Number.isSafeInteger(this.maxSessionTtlMs) || this.maxSessionTtlMs < 1_000 || this.maxSessionTtlMs > 7 * 24 * 60 * 60 * 1_000) {
      throw new RangeError('workspace runtime: maxSessionTtlMs must be from 1000 ms to 7 days')
    }
    if (!Number.isSafeInteger(this.maxCommandTimeoutMs) || this.maxCommandTimeoutMs < 1 || this.maxCommandTimeoutMs > 60 * 60 * 1_000) {
      throw new RangeError('workspace runtime: maxCommandTimeoutMs must be from 1 ms to 1 hour')
    }
    if (!Number.isSafeInteger(this.maxOutputBytes) || this.maxOutputBytes < 1 || this.maxOutputBytes > 64 * 1024 * 1024) {
      throw new RangeError('workspace runtime: maxOutputBytes must be from 1 byte to 64 MiB')
    }
    if (!Number.isSafeInteger(this.maxCapabilityTtlMs) || this.maxCapabilityTtlMs < 1_000 || this.maxCapabilityTtlMs > this.maxSessionTtlMs) {
      throw new RangeError('workspace runtime: maxCapabilityTtlMs must be from 1000 ms to the session TTL limit')
    }
  }

  private currentTime(): number {
    const value = this.now()
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('workspace runtime: clock must return a non-negative safe integer')
    return value
  }

  private async assertCurrentLease(session: WorkspaceSession): Promise<{ leaseId: string; fencingToken: number }> {
    const leaseId = session.leaseId
    const fencingToken = session.fencingToken
    if (!leaseId || typeof fencingToken !== 'number' || !Number.isSafeInteger(fencingToken) ||
        !await this.leases.isCurrent(leaseId, this.ownerId, fencingToken)) {
      throw new Error('workspace runtime: lease is not current for this owner')
    }
    return { leaseId, fencingToken }
  }

  private async transition(session: WorkspaceSession, expectedState: WorkspaceSession['state'], nextState: WorkspaceSession['state']): Promise<WorkspaceSession> {
    const lease = await this.assertCurrentLease(session)
    return this.sessions.transitionSession({
      workspaceId: session.workspaceId,
      ownerId: this.ownerId,
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      expectedState,
      nextState,
    })
  }

  async open(input: OpenWorkspaceInput): Promise<WorkspaceSession> {
    const taskId = required('taskId', input.taskId)
    const sessionId = required('sessionId', input.sessionId)
    const idempotencyKey = required('idempotencyKey', input.idempotencyKey)
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(idempotencyKey)) throw new TypeError('workspace runtime: invalid idempotencyKey')
    if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1_000 || input.ttlMs > this.maxSessionTtlMs) throw new RangeError('workspace runtime: session TTL exceeds configured bounds')
    if (input.signal?.aborted) throw new Error('workspace runtime: session creation aborted')

    const workspaceId = workspaceIdFor(this.projectId, taskId, sessionId)
    const existing = await this.sessions.getTaskSession(this.projectId, taskId, sessionId)
    if (existing) {
      if (existing.ownerId === this.ownerId && existing.provider === this.provider.name && existing.state === 'ready' && await this.leases.isCurrent(existing.leaseId ?? '', this.ownerId, existing.fencingToken ?? 0)) return existing
      throw new Error('workspace runtime: task session already exists; recovery requires an expired lease and provider validation')
    }

    const decision = await this.leases.acquire({
      projectId: this.projectId,
      resourceType: 'workspace',
      resourceId: workspaceId,
      ownerId: this.ownerId,
      idempotencyKey: `workspace-attempt:${randomUUID()}`,
      ttlMs: input.ttlMs,
    })
    if (!decision.acquired) throw new Error(`workspace runtime: workspace lease unavailable (${decision.reason})`)

    const now = this.currentTime()
    const lease = decision.lease
    const creating: WorkspaceSession = {
      workspaceId,
      projectId: this.projectId,
      taskId,
      sessionId,
      provider: this.provider.name,
      ownerId: this.ownerId,
      state: 'creating',
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      createdAt: new Date(now).toISOString(),
      expiresAt: lease.expiresAt,
    }

    try {
      await this.sessions.createSession({ ...creating, idempotencyKey })
    } catch (error) {
      await this.leases.release(lease.leaseId, this.ownerId, lease.fencingToken)
      throw error
    }

    const providerInput: CreateWorkspaceSessionInput = {
      workspaceId,
      ownerId: this.ownerId,
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      projectId: this.projectId,
      taskId,
      sessionId,
      provider: this.provider.name,
      ttlMs: input.ttlMs,
      idempotencyKey,
      signal: input.signal,
    }

    try {
      const created = await this.provider.create(providerInput)
      if (created.workspaceId !== workspaceId || created.projectId !== this.projectId || created.taskId !== taskId ||
          created.sessionId !== sessionId || created.provider !== this.provider.name || created.ownerId !== this.ownerId ||
          created.leaseId !== lease.leaseId || created.fencingToken !== lease.fencingToken || created.state !== 'ready' ||
          isoTimestamp('session expiry', created.expiresAt) > isoTimestamp('lease expiry', lease.expiresAt)) {
        throw new Error('workspace runtime: provider returned a session outside the requested ownership or expiry scope')
      }
      if (!await this.leases.isCurrent(lease.leaseId, this.ownerId, lease.fencingToken)) throw new Error('workspace runtime: lease expired during provider creation')
      return this.sessions.transitionSession({
        workspaceId,
        ownerId: this.ownerId,
        leaseId: lease.leaseId,
        fencingToken: lease.fencingToken,
        expectedState: 'creating',
        nextState: 'ready',
        expiresAt: created.expiresAt,
      })
    } catch (error) {
      let confirmed = false
      try { confirmed = (await this.provider.close({ workspaceId, reason: 'workspace creation failed', ownerId: this.ownerId, leaseId: lease.leaseId, fencingToken: lease.fencingToken })).confirmed } catch { /* keep lease until expiry */ }
      const stillCurrent = await this.leases.isCurrent(lease.leaseId, this.ownerId, lease.fencingToken)
      if (stillCurrent) {
        try {
          await this.sessions.transitionSession({
            workspaceId,
            ownerId: this.ownerId,
            leaseId: lease.leaseId,
            fencingToken: lease.fencingToken,
            expectedState: 'creating',
            nextState: confirmed ? 'failed' : 'unknown',
          })
        } catch { /* a newer fence or changed state must not be overwritten */ }
        if (confirmed) await this.leases.release(lease.leaseId, this.ownerId, lease.fencingToken)
      }
      throw error
    }
  }

  async issueCapability(input: IssueWorkspaceCapabilityInput): Promise<WorkspaceCapability> {
    const workspaceId = required('workspaceId', input.workspaceId)
    const session = await this.sessions.getSession(workspaceId)
    if (!session || session.provider !== this.provider.name || session.state !== 'ready') throw new Error('workspace runtime: session is not ready for this provider')
    const lease = await this.assertCurrentLease(session)
    if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1_000 || input.ttlMs > this.maxCapabilityTtlMs) throw new RangeError('workspace runtime: capability TTL exceeds configured bounds')
    const allowedOperations = new Set<WorkspaceOperation>(['list', 'read', 'write', 'execute', 'collect'])
    if (!Array.isArray(input.operations) || input.operations.length === 0 || input.operations.length > allowedOperations.size ||
        input.operations.some((operation) => !allowedOperations.has(operation)) || new Set(input.operations).size !== input.operations.length ||
        !Array.isArray(input.pathPrefixes) || input.pathPrefixes.length > 128) {
      throw new TypeError('workspace runtime: invalid capability scope')
    }
    const validPath = (path: string) => path === '' || (path.length <= 1_024 && !path.includes('\0') && !path.includes('\\') &&
      !path.startsWith('/') && !/^[A-Za-z]:/.test(path) && !path.split('/').some((part) => !part || part === '.' || part === '..'))
    if (input.pathPrefixes.some((prefix) => typeof prefix !== 'string' || !validPath(prefix)) || new Set(input.pathPrefixes).size !== input.pathPrefixes.length) {
      throw new TypeError('workspace runtime: path prefixes must be canonical and unique')
    }
    const now = this.currentTime()
    const sessionExpiry = isoTimestamp('session expiry', session.expiresAt)
    if (now + input.ttlMs > sessionExpiry) throw new RangeError('workspace runtime: capability TTL exceeds session expiry')
    const capability = await this.provider.issueCapability({
      workspaceId,
      projectId: this.projectId,
      taskId: session.taskId,
      sessionId: session.sessionId,
      fencingToken: lease.fencingToken,
      operations: input.operations,
      pathPrefixes: input.pathPrefixes,
      ttlMs: input.ttlMs,
    })
    let capabilityExpiry = 0
    let validCapability = false
    try {
      capabilityExpiry = isoTimestamp('capability expiry', capability.expiresAt)
      validCapability = capability.workspaceId === workspaceId && capability.projectId === this.projectId &&
        capability.taskId === session.taskId && capability.sessionId === session.sessionId &&
        capability.fencingToken === lease.fencingToken &&
        sameStrings(capability.operations, input.operations) && sameStrings(capability.pathPrefixes, input.pathPrefixes) &&
        capabilityExpiry > now && capabilityExpiry <= now + input.ttlMs && capabilityExpiry <= sessionExpiry &&
        await this.leases.isCurrent(lease.leaseId, this.ownerId, lease.fencingToken)
    } catch { validCapability = false }
    if (!validCapability) {
      if (capability && typeof capability.capabilityId === 'string' && capability.capabilityId) {
        try { await this.provider.revoke(capability.capabilityId, 'provider returned an invalid capability scope') } catch { /* local grant was never stored */ }
      }
      throw new Error('workspace runtime: provider returned a capability outside the requested scope')
    }
    try {
      await this.sessions.recordCapability(capability)
    } catch (error) {
      try { await this.provider.revoke(capability.capabilityId, 'capability persistence failed') } catch { /* deny locally even if remote revoke needs retry */ }
      throw error
    }
    return capability
  }

  async execute(workspaceId: string, capability: WorkspaceCapability, command: WorkspaceCommand): Promise<WorkspaceCommandResult> {
    const session = await this.sessions.getSession(required('workspaceId', workspaceId))
    if (!session || session.provider !== this.provider.name || session.state !== 'ready') throw new Error('workspace runtime: session is not ready for this provider')
    const lease = await this.assertCurrentLease(session)
    if (!capability || !Array.isArray(capability.operations) || capability.fencingToken !== lease.fencingToken ||
        capability.workspaceId !== workspaceId || capability.projectId !== this.projectId || capability.taskId !== session.taskId ||
        capability.sessionId !== session.sessionId || !capability.operations.includes('execute') ||
        isoTimestamp('capability expiry', capability.expiresAt) <= this.currentTime()) throw new Error('workspace runtime: stale or mis-scoped capability')
    validateCommand(command, this.maxCommandTimeoutMs, this.maxOutputBytes)
    const allowed = await this.sessions.authorizeCapability({
      token: capability.token,
      projectId: this.projectId,
      taskId: session.taskId,
      sessionId: session.sessionId,
      workspaceId,
      operation: 'execute',
      path: command.cwd,
      now: this.currentTime(),
    })
    if (!allowed) throw new Error('workspace runtime: command capability denied')

    await this.transition(session, 'ready', 'running')
    try {
      const result = await this.provider.execute(workspaceId, capability, command)
      validateResult(result, command.maxOutputBytes)
      await this.transition(session, 'running', 'ready')
      return result
    } catch (error) {
      try {
        await this.transition(session, 'running', 'unknown')
      } catch { /* retain the newer state/fence */ }
      throw error
    }
  }

  async revokeCapability(capabilityId: string, reason: string): Promise<void> {
    required('capabilityId', capabilityId)
    required('revocation reason', reason, 512)
    await this.sessions.revokeCapability(capabilityId, reason)
    await this.provider.revoke(capabilityId, reason)
  }

  async close(workspaceId: string, reason: string): Promise<{ readonly confirmed: boolean; readonly detail?: string }> {
    required('workspaceId', workspaceId)
    required('close reason', reason, 512)
    const session = await this.sessions.getSession(workspaceId)
    if (!session) throw new Error('workspace runtime: session does not exist')
    if (session.provider !== this.provider.name) throw new Error('workspace runtime: session belongs to a different provider')
    if (session.state === 'closed') return { confirmed: true }
    const lease = await this.assertCurrentLease(session)
    if (session.state !== 'closing') {
      await this.transition(session, session.state, 'closing')
    }
    await this.sessions.revokeWorkspaceCapabilities(workspaceId, reason)
    let result: { readonly confirmed: boolean; readonly detail?: string }
    try {
      result = await this.provider.close({ workspaceId, reason, ownerId: this.ownerId, leaseId: lease.leaseId, fencingToken: lease.fencingToken })
    } catch (error) {
      try {
        await this.sessions.transitionSession({
          workspaceId,
          ownerId: this.ownerId,
          leaseId: lease.leaseId,
          fencingToken: lease.fencingToken,
          expectedState: 'closing',
          nextState: 'unknown',
        })
      } catch { /* retain the current state if the lease/fence changed */ }
      throw error
    }
    if (!result || typeof result.confirmed !== 'boolean') {
      await this.sessions.transitionSession({
        workspaceId, ownerId: this.ownerId, leaseId: lease.leaseId, fencingToken: lease.fencingToken,
        expectedState: 'closing', nextState: 'unknown',
      })
      throw new Error('workspace runtime: provider returned an invalid close confirmation')
    }
    await this.transition(session, 'closing', result.confirmed ? 'closed' : 'unknown')
    if (result.confirmed) await this.leases.release(lease.leaseId, this.ownerId, lease.fencingToken)
    return result
  }
}
