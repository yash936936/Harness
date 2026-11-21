/** Persistent, task-scoped Vercel Sandbox workspace session provider. */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import type {
  CreateWorkspaceSessionInput,
  LeaseStore,
  WorkspaceCapability,
  WorkspaceCommand,
  WorkspaceCommandResult,
  WorkspaceOperation,
  WorkspaceSession,
  WorkspaceSessionProvider,
  WorkspaceSessionStore,
} from '../../architecture/contracts.js'

const PROVIDER_TAG = 'harness-workspace-v1'
const WORKSPACE_USER = 'harness'
const MAX_SESSION_COMMAND_TIMEOUT_MS = 60 * 60 * 1_000
const MAX_WORKSPACE_TTL_MS = 7 * 24 * 60 * 60 * 1_000
const MAX_CAPABILITY_TTL_MS = 60 * 60 * 1_000
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024
const DEFAULT_SANDBOX_TIMEOUT_MS = 15 * 60 * 1_000
const DEFAULT_SNAPSHOT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1_000

export interface VercelWorkspaceCommand {
  logs(options?: { signal?: AbortSignal }): AsyncIterable<{ stream: 'stdout' | 'stderr'; data: string }>
  wait(options?: { signal?: AbortSignal }): Promise<{ exitCode: number | null }>
  kill(signal?: 'SIGHUP' | 'SIGINT' | 'SIGQUIT' | 'SIGKILL' | 'SIGTERM' | 'SIGCONT' | 'SIGSTOP' | number): Promise<void>
}

export interface VercelWorkspaceUser {
  readonly homeDir: string
  mkDir(path: string, options?: { signal?: AbortSignal }): Promise<void>
  runCommand(options: {
    cmd: string
    args: string[]
    cwd?: string
    timeoutMs?: number
    signal?: AbortSignal
    detached: true
  }): Promise<VercelWorkspaceCommand>
}

export interface VercelWorkspaceSandbox {
  readonly name: string
  readonly tags?: Record<string, string>
  createUser(username: string, options?: { signal?: AbortSignal }): Promise<VercelWorkspaceUser>
  asUser(username: string): VercelWorkspaceUser
  update(options: { networkPolicy: 'deny-all' }): Promise<void>
  delete(options?: { deleteOrphanSnapshots?: boolean }): Promise<void>
  fs: {
    realpath(path: string, options?: { signal?: AbortSignal }): Promise<string>
  }
}

export interface VercelWorkspaceClient {
  create(options: {
    name: string
    persistent: true
    networkPolicy: 'deny-all'
    timeout: number
    snapshotExpiration: number
    keepLastSnapshots: { count: 1; deleteEvicted: true }
    tags: Record<string, string>
    signal?: AbortSignal
  }): Promise<VercelWorkspaceSandbox>
  get(options: { name: string; resume: boolean; signal?: AbortSignal }): Promise<VercelWorkspaceSandbox>
}

export interface VercelWorkspaceEgressGate {
  status(): Promise<{ readonly projectId: string; readonly consented: boolean }>
  assertAllowedHost(host: string): void
}

export interface VercelWorkspaceProviderOptions {
  /** Project-scoped consent and exact host allowlist gate. */
  readonly egress: VercelWorkspaceEgressGate
  /** Injected SDK client for tests or controlled integrations. */
  readonly client?: VercelWorkspaceClient
  readonly sessions: WorkspaceSessionStore
  readonly leases: LeaseStore
  readonly ownerId: string
  readonly now?: () => number
  /** Per-VM timeout. Persistent sandboxes can resume after an idle stop. */
  readonly sandboxTimeoutMs?: number
  readonly snapshotExpirationMs?: number
}

interface Capture {
  stdout: string
  stderr: string
  stdoutBytes: number
  stderrBytes: number
  truncated: boolean
}

class CombinedTextCapture {
  private stdout = ''
  private stderr = ''
  private used = 0
  private stdoutBytes = 0
  private stderrBytes = 0
  truncated = false

  constructor(private readonly limit: number) {}

  write(stream: 'stdout' | 'stderr', chunk: string): void {
    if (this.truncated || !chunk) return
    let kept = ''
    for (const char of chunk) {
      const size = Buffer.byteLength(char, 'utf8')
      if (this.used + size > this.limit) {
        this.truncated = true
        break
      }
      kept += char
      this.used += size
      if (stream === 'stdout') this.stdoutBytes += size
      else this.stderrBytes += size
    }
    if (stream === 'stdout') this.stdout += kept
    else this.stderr += kept
  }

  result(): Capture {
    const marker = this.truncated ? '\n[output truncated by Vercel workspace provider]' : ''
    return {
      stdout: this.stdout + (this.truncated && this.stdoutBytes >= this.stderrBytes ? marker : ''),
      stderr: this.stderr + (this.truncated && this.stdoutBytes < this.stderrBytes ? marker : ''),
      stdoutBytes: this.stdoutBytes,
      stderrBytes: this.stderrBytes,
      truncated: this.truncated,
    }
  }
}

function canonicalRelativePath(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_024 ||
      value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false
  return !value.split('/').some((part) => !part || part === '.' || part === '..')
}

function scopeDigest(session: Pick<WorkspaceSession,
  'workspaceId' | 'projectId' | 'taskId' | 'sessionId' | 'ownerId' | 'leaseId' | 'fencingToken'
>): string {
  return createHash('sha256').update(JSON.stringify({
    version: 1,
    workspaceId: session.workspaceId,
    projectId: session.projectId,
    taskId: session.taskId,
    sessionId: session.sessionId,
    ownerId: session.ownerId,
    leaseId: session.leaseId,
    fencingToken: session.fencingToken,
  }), 'utf8').digest('hex')
}

function notFound(error: unknown): boolean {
  const value = error as { status?: number; statusCode?: number; code?: string; name?: string }
  return value?.status === 404 || value?.statusCode === 404 || value?.code === 'NOT_FOUND' || value?.name === 'NotFoundError'
}

function detail(error: unknown): string {
  return String((error as { message?: unknown })?.message ?? error).slice(0, 300)
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('workspace command aborted'))
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => { cleanup(); reject(signal.reason ?? new Error('workspace command aborted')) }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    promise.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
  })
}

async function loadClient(): Promise<VercelWorkspaceClient> {
  let mod: any
  try {
    mod = await import('@vercel/sandbox' as string)
  } catch {
    throw new Error('vercel-workspace: install @vercel/sandbox and configure Vercel authentication')
  }
  if (!mod?.Sandbox || typeof mod.Sandbox.create !== 'function' || typeof mod.Sandbox.get !== 'function') {
    throw new Error('vercel-workspace: installed SDK must expose Sandbox.create and Sandbox.get')
  }
  const token = process.env.VERCEL_TOKEN
  const teamId = process.env.VERCEL_TEAM_ID
  const projectId = process.env.VERCEL_PROJECT_ID
  if (!token || !teamId || !projectId) {
    throw new Error('vercel-workspace: set VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID in the host environment')
  }
  return {
    create: (options) => mod.Sandbox.create({ ...options, token, teamId, projectId }),
    get: (options) => mod.Sandbox.get({ ...options, token, teamId, projectId }),
  }
}

/**
 * Persistent, task-scoped Vercel Sandbox sessions. The SDK handle and Vercel
 * credentials remain in the host process; guest commands run as a dedicated
 * unprivileged Linux user. SQLite session/capability metadata and lease fences
 * are rechecked by this provider before every operation.
 */
export class VercelWorkspaceSessionProvider implements WorkspaceSessionProvider {
  readonly name = 'vercel'
  private readonly sessions: WorkspaceSessionStore
  private readonly leases: LeaseStore
  private readonly ownerId: string
  private readonly egress: VercelWorkspaceEgressGate
  private readonly now: () => number
  private readonly sandboxTimeoutMs: number
  private readonly snapshotExpirationMs: number
  private client?: VercelWorkspaceClient
  private clientPromise?: Promise<VercelWorkspaceClient>

  constructor(options: VercelWorkspaceProviderOptions) {
    if (!options.sessions || !options.leases || !options.egress) throw new TypeError('vercel-workspace: session store, lease store, and egress gate are required')
    if (typeof options.ownerId !== 'string' || !options.ownerId.trim() || options.ownerId.length > 256) {
      throw new TypeError('vercel-workspace: ownerId is required')
    }
    this.sessions = options.sessions
    this.leases = options.leases
    this.ownerId = options.ownerId
    this.egress = options.egress
    this.now = options.now ?? Date.now
    this.sandboxTimeoutMs = options.sandboxTimeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS
    this.snapshotExpirationMs = options.snapshotExpirationMs ?? DEFAULT_SNAPSHOT_EXPIRATION_MS
    if (!Number.isSafeInteger(this.sandboxTimeoutMs) || this.sandboxTimeoutMs < 1_000 || this.sandboxTimeoutMs > MAX_SESSION_COMMAND_TIMEOUT_MS) {
      throw new RangeError('vercel-workspace: sandboxTimeoutMs must be from 1000 ms to 1 hour')
    }
    if (!Number.isSafeInteger(this.snapshotExpirationMs) || this.snapshotExpirationMs < 1_000) {
      throw new RangeError('vercel-workspace: snapshotExpirationMs must be a positive safe integer')
    }
    if (options.client) this.client = options.client
  }

  private async getClient(): Promise<VercelWorkspaceClient> {
    if (this.client) return this.client
    this.clientPromise ??= loadClient()
    this.client = await this.clientPromise
    return this.client
  }

  private async assertSession(
    workspaceId: string,
    states: readonly WorkspaceSession['state'][],
  ): Promise<WorkspaceSession> {
    const session = await this.sessions.getSession(workspaceId)
    if (!session || session.provider !== this.name || session.ownerId !== this.ownerId ||
        !session.leaseId || !Number.isSafeInteger(session.fencingToken) || !states.includes(session.state)) {
      throw new Error('vercel-workspace: workspace session is missing, stale, or in an invalid state')
    }
    if (!await this.leases.isCurrent(session.leaseId, this.ownerId, session.fencingToken!)) {
      throw new Error('vercel-workspace: workspace lease fencing token is stale')
    }
    return session
  }

  private async assertEgress(projectId: string): Promise<void> {
    const status = await this.egress.status()
    if (status.projectId !== projectId || status.consented !== true) {
      throw new Error('vercel-workspace: project-scoped remote egress consent is required')
    }
    this.egress.assertAllowedHost('vercel.com')
  }

  private assertSandboxScope(sandbox: VercelWorkspaceSandbox, session: WorkspaceSession): void {
    if (sandbox.name !== session.workspaceId || sandbox.tags?.['harness_provider'] !== PROVIDER_TAG ||
        sandbox.tags?.['harness_scope'] !== scopeDigest(session)) {
      throw new Error('vercel-workspace: remote sandbox identity does not match the durable workspace scope')
    }
  }

  private async getSandbox(session: WorkspaceSession, resume: boolean, signal?: AbortSignal): Promise<VercelWorkspaceSandbox> {
    await this.assertEgress(session.projectId)
    const sandbox = await (await this.getClient()).get({ name: session.workspaceId, resume, signal })
    this.assertSandboxScope(sandbox, session)
    // Reassert the restrictive policy on every reattachment before guest commands run.
    await sandbox.update({ networkPolicy: 'deny-all' })
    return sandbox
  }

  async create(input: CreateWorkspaceSessionInput): Promise<WorkspaceSession> {
    if (input.provider !== this.name || input.ownerId !== this.ownerId ||
        !Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1_000 || input.ttlMs > MAX_WORKSPACE_TTL_MS) {
      throw new TypeError('vercel-workspace: invalid workspace creation scope')
    }
    input.signal?.throwIfAborted()
    const session = await this.sessions.getSession(input.workspaceId)
    if (!session || session.state !== 'creating' || session.provider !== this.name ||
        session.ownerId !== input.ownerId || session.projectId !== input.projectId ||
        session.taskId !== input.taskId || session.sessionId !== input.sessionId ||
        session.leaseId !== input.leaseId || session.fencingToken !== input.fencingToken) {
      throw new Error('vercel-workspace: no matching fenced creating session exists')
    }
    if (!await this.leases.isCurrent(input.leaseId, input.ownerId, input.fencingToken)) {
      throw new Error('vercel-workspace: lease fencing token is stale before remote creation')
    }
    const tags = {
      harness_provider: PROVIDER_TAG,
      harness_scope: scopeDigest(session),
    }
    await this.assertEgress(input.projectId)
    const client = await this.getClient()
    const sandbox = await client.create({
      name: input.workspaceId,
      persistent: true,
      networkPolicy: 'deny-all',
      timeout: Math.min(this.sandboxTimeoutMs, input.ttlMs),
      snapshotExpiration: this.snapshotExpirationMs,
      keepLastSnapshots: { count: 1, deleteEvicted: true },
      tags,
      signal: input.signal,
    })
    try {
      this.assertSandboxScope(sandbox, session)
      await sandbox.update({ networkPolicy: 'deny-all' })
      const user = await sandbox.createUser(WORKSPACE_USER, { signal: input.signal })
      if (!user.homeDir.startsWith('/') || user.homeDir.includes('\0')) throw new Error('vercel-workspace: SDK returned an invalid isolated user home')
      await user.mkDir('workspace', { signal: input.signal })
      input.signal?.throwIfAborted()
      return { ...session, state: 'ready' }
    } catch (error) {
      try {
        await sandbox.delete({ deleteOrphanSnapshots: true })
      } catch (cleanupError) {
        throw new Error(`vercel-workspace: creation failed (${detail(error)}); sandbox cleanup was not confirmed (${detail(cleanupError)})`)
      }
      throw error
    }
  }

  async issueCapability(input: {
    readonly workspaceId: string
    readonly projectId: string
    readonly fencingToken: number
    readonly taskId: string
    readonly sessionId: string
    readonly operations: readonly WorkspaceOperation[]
    readonly pathPrefixes: readonly string[]
    readonly ttlMs: number
  }): Promise<WorkspaceCapability> {
    const session = await this.assertSession(input.workspaceId, ['ready'])
    if (session.projectId !== input.projectId || session.taskId !== input.taskId ||
        session.sessionId !== input.sessionId || session.fencingToken !== input.fencingToken ||
        !Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1_000 || input.ttlMs > MAX_CAPABILITY_TTL_MS ||
        !Array.isArray(input.operations) || input.operations.length === 0 ||
        !Array.isArray(input.pathPrefixes) || input.pathPrefixes.length > 128) {
      throw new TypeError('vercel-workspace: invalid capability scope')
    }
    const allowed = new Set<WorkspaceOperation>(['list', 'read', 'write', 'execute', 'collect'])
    if (input.operations.some((operation) => !allowed.has(operation)) ||
        new Set(input.operations).size !== input.operations.length ||
        input.pathPrefixes.some((path) => path !== '' && !canonicalRelativePath(path)) ||
        new Set(input.pathPrefixes).size !== input.pathPrefixes.length) {
      throw new TypeError('vercel-workspace: invalid capability operations or paths')
    }
    const expiresAtMs = this.now() + input.ttlMs
    const sessionExpiry = Date.parse(session.expiresAt)
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs > sessionExpiry) {
      throw new RangeError('vercel-workspace: capability expiry exceeds session expiry')
    }
    return {
      token: randomBytes(32).toString('base64url'),
      capabilityId: randomUUID(),
      projectId: session.projectId,
      taskId: session.taskId,
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      fencingToken: input.fencingToken,
      operations: [...input.operations],
      pathPrefixes: [...input.pathPrefixes],
      expiresAt: new Date(expiresAtMs).toISOString(),
    }
  }

  async execute(workspaceId: string, capability: WorkspaceCapability, command: WorkspaceCommand): Promise<WorkspaceCommandResult> {
    const session = await this.assertSession(workspaceId, ['running'])
    if (!capability || capability.workspaceId !== workspaceId || capability.projectId !== session.projectId ||
        capability.taskId !== session.taskId || capability.sessionId !== session.sessionId ||
        capability.fencingToken !== session.fencingToken || !capability.operations.includes('execute') ||
        !Number.isFinite(Date.parse(capability.expiresAt)) || Date.parse(capability.expiresAt) <= this.now() ||
        !canonicalRelativePath(command.cwd)) {
      throw new Error('vercel-workspace: command capability or working directory is invalid')
    }
    const allowed = await this.sessions.authorizeCapability({
      token: capability.token,
      projectId: session.projectId,
      taskId: session.taskId,
      sessionId: session.sessionId,
      workspaceId,
      operation: 'execute',
      path: command.cwd,
      now: this.now(),
    })
    if (!allowed) throw new Error('vercel-workspace: command capability denied')
    if (!Number.isSafeInteger(command.timeoutMs) || command.timeoutMs < 1 || command.timeoutMs > MAX_SESSION_COMMAND_TIMEOUT_MS ||
        !Number.isSafeInteger(command.maxOutputBytes) || command.maxOutputBytes < 1 || command.maxOutputBytes > MAX_COMMAND_OUTPUT_BYTES ||
        typeof command.command !== 'string' || !command.command.trim() || command.command.includes('\0') ||
        !Array.isArray(command.args) || command.args.length > 256 ||
        command.args.some((arg) => typeof arg !== 'string' || arg.includes('\0') || arg.length > 8_192)) {
      throw new TypeError('vercel-workspace: invalid command request')
    }
    const sandbox = await this.getSandbox(session, true, command.signal)
    const user = sandbox.asUser(WORKSPACE_USER)
    const root = posix.join(user.homeDir, 'workspace')
    const cwd = posix.resolve(root, command.cwd)
    const relative = posix.relative(root, cwd)
    if (relative === '..' || relative.startsWith('../') || posix.isAbsolute(relative)) {
      throw new Error('vercel-workspace: command working directory escapes the workspace')
    }
    const realCwd = await sandbox.fs.realpath(cwd, { signal: command.signal })
    const realRelative = posix.relative(root, realCwd)
    if (realRelative === '..' || realRelative.startsWith('../') || posix.isAbsolute(realRelative)) {
      throw new Error('vercel-workspace: command working directory resolves outside the workspace')
    }

    const startedAt = this.now()
    const capture = new CombinedTextCapture(command.maxOutputBytes)
    let remoteCommand: VercelWorkspaceCommand | undefined
    let timedOut = false
    let killRequested = false
    let terminationFailure: unknown
    const timeoutController = new AbortController()
    const executionSignal = command.signal ? AbortSignal.any([command.signal, timeoutController.signal]) : timeoutController.signal
    const deadline = setTimeout(() => {
      timedOut = true
      timeoutController.abort(new Error('workspace command timed out'))
      if (remoteCommand && !killRequested) {
        killRequested = true
        void remoteCommand.kill('SIGTERM').catch((error) => { terminationFailure = error })
      }
    }, command.timeoutMs)
    try {
      remoteCommand = await user.runCommand({
        cmd: command.command,
        args: [...command.args],
        cwd,
        timeoutMs: command.timeoutMs,
        signal: executionSignal,
        detached: true,
      })
      if (timedOut && !killRequested) {
        killRequested = true
        await remoteCommand.kill('SIGTERM').catch(() => {})
      }
      let waitSettled = false
      const wait = raceAbort(remoteCommand.wait({ signal: executionSignal }), executionSignal)
        .finally(() => { waitSettled = true })
      const consume = async () => {
        for await (const log of remoteCommand!.logs({ signal: executionSignal })) {
          executionSignal.throwIfAborted()
          capture.write(log.stream, log.data)
          if (capture.truncated && !killRequested && !waitSettled) {
            killRequested = true
            try { await remoteCommand!.kill('SIGTERM') }
            catch (error) { if (!waitSettled) throw error }
          }
        }
      }
      const [result] = await Promise.all([wait, consume()])
      if (terminationFailure) throw new Error(`vercel-workspace: timed-out command termination was not confirmed (${detail(terminationFailure)})`)
      const captured = capture.result()
      return {
        exitCode: timedOut ? null : result.exitCode,
        ...captured,
        timedOut,
        aborted: false,
      }
    } catch (error) {
      if (remoteCommand && !killRequested) {
        try { await remoteCommand.kill('SIGTERM') }
        catch (killError) {
          throw new Error(`vercel-workspace: command failed (${detail(error)}); remote termination was not confirmed (${detail(killError)})`)
        }
      }
      if (command.signal?.aborted) {
        const captured = capture.result()
        return { exitCode: null, ...captured, timedOut: false, aborted: true }
      }
      if (timedOut || executionSignal.aborted || /timeout|timed out|deadline/i.test(detail(error))) {
        if (terminationFailure) throw new Error(`vercel-workspace: timed-out command termination was not confirmed (${detail(terminationFailure)})`)
        const captured = capture.result()
        return { exitCode: null, ...captured, timedOut: true, aborted: false }
      }
      throw error
    } finally {
      clearTimeout(deadline)
    }
  }

  async revoke(capabilityId: string, reason: string): Promise<void> {
    if (!capabilityId || typeof reason !== 'string' || !reason.trim() || reason.length > 512) {
      throw new TypeError('vercel-workspace: invalid capability revocation')
    }
    // SQLite is the provider-side authorization authority; no bearer token is
    // retained in the Vercel sandbox or in this process.
    await this.sessions.revokeCapability(capabilityId, reason)
  }

  async close(input: {
    readonly workspaceId: string
    readonly reason: string
    readonly ownerId: string
    readonly leaseId: string
    readonly fencingToken: number
  }): Promise<{ readonly confirmed: boolean; readonly detail?: string }> {
    const session = await this.assertSession(input.workspaceId, ['creating', 'closing', 'failed', 'unknown'])
    if (input.ownerId !== this.ownerId || session.leaseId !== input.leaseId ||
        session.fencingToken !== input.fencingToken) {
      return { confirmed: false, detail: 'workspace owner or fencing token does not match' }
    }
    let sandbox: VercelWorkspaceSandbox
    try {
      await this.assertEgress(session.projectId)
      sandbox = await (await this.getClient()).get({ name: input.workspaceId, resume: false })
    } catch (error) {
      if (notFound(error)) return { confirmed: true, detail: 'remote sandbox was already absent' }
      return { confirmed: false, detail: `could not verify remote sandbox: ${detail(error)}` }
    }
    try {
      this.assertSandboxScope(sandbox, session)
    } catch (error) {
      return { confirmed: false, detail: detail(error) }
    }
    try {
      await sandbox.delete({ deleteOrphanSnapshots: true })
      return { confirmed: true }
    } catch (error) {
      return { confirmed: false, detail: `sandbox deletion was not confirmed: ${detail(error)}` }
    }
  }
}
