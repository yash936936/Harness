/**
 * Backend-neutral contracts for the next shared-state, memory, and workspace
 * architecture. These are type-only boundaries: existing providers and
 * persisted formats remain unchanged until an adapter is introduced.
 *
 * Implementations must document transaction isolation, durability, and
 * failure semantics. A method described as atomic must commit all of its
 * effects or none of them.
 */

export type ProjectId = string
export type TaskId = string
export type SessionId = string
export type OperationId = string
export type ResourceId = string
export type Cursor = string

export interface Page<T> {
  readonly items: readonly T[]
  /** Omitted only when the result set is exhausted. */
  readonly nextCursor?: Cursor
}

export interface IdempotentCommand {
  /** Stable across retries of the same logical operation. */
  readonly idempotencyKey: string
}

export interface ClockedRecord {
  readonly createdAt: string
  readonly updatedAt: string
}

/* ---------------------------------------------------------------- shared state */

export type BudgetMetric = 'requests' | 'tokens' | 'bytes' | 'operations'

export interface BudgetReservationRequest extends IdempotentCommand {
  readonly projectId: ProjectId
  readonly subjectId: string
  readonly metric: BudgetMetric
  readonly amount: number
  readonly hardLimit: number
  readonly expiresAt: string
}

export interface BudgetReservation {
  readonly reservationId: ResourceId
  readonly projectId: ProjectId
  readonly subjectId: string
  readonly metric: BudgetMetric
  readonly reservedAmount: number
  readonly state: 'reserved' | 'settled' | 'released' | 'expired'
  readonly expiresAt: string
}

export type ReservationDecision =
  | { readonly accepted: true; readonly reservation: BudgetReservation }
  | { readonly accepted: false; readonly reason: 'limit-exceeded' | 'idempotency-conflict' }

export interface BudgetSettlement extends IdempotentCommand {
  readonly reservationId: ResourceId
  readonly actualAmount: number
}

export interface BudgetReservationStore {
  /**
   * Atomically checks committed usage plus all live reservations, then creates
   * one reservation. Replaying the same key and identical payload returns the
   * original decision; reusing it with different input is a conflict.
   */
  reserve(input: BudgetReservationRequest): Promise<ReservationDecision>
  /** Atomically settles once. Repeated identical settlements are no-ops. */
  settle(input: BudgetSettlement): Promise<BudgetReservation>
  /** Idempotently releases a reservation. A settled reservation is unchanged. */
  release(reservationId: ResourceId, reason: string): Promise<BudgetReservation>
}

export interface RateLimitRequest extends IdempotentCommand {
  readonly projectId: ProjectId
  readonly principalId: string
  readonly bucket: string
  readonly limit: number
  readonly windowMs: number
  readonly maxConcurrent: number
  readonly permitTtlMs: number
}

export interface RateLimitPermit {
  readonly permitId: ResourceId
  readonly projectId: ProjectId
  readonly principalId: string
  readonly bucket: string
  readonly fencingToken: number
  readonly expiresAt: string
}

export type RateLimitDecision =
  | { readonly accepted: true; readonly permit: RateLimitPermit }
  | { readonly accepted: false; readonly reason: 'rate-limited' | 'concurrency-limit' | 'idempotency-conflict'; readonly retryAt?: string }

export interface RateLimitStore {
  /** Window accounting and concurrency permit creation must be one transaction. */
  acquire(input: RateLimitRequest): Promise<RateLimitDecision>
  /** Idempotent release; expired permits are reclaimed by bounded cleanup. */
  release(permitId: ResourceId): Promise<void>
}

export interface LeaseRequest extends IdempotentCommand {
  readonly projectId: ProjectId
  readonly resourceType: 'workspace' | 'job' | 'index'
  readonly resourceId: ResourceId
  readonly ownerId: string
  readonly ttlMs: number
}

export interface Lease {
  readonly leaseId: ResourceId
  readonly projectId: ProjectId
  readonly resourceType: LeaseRequest['resourceType']
  readonly resourceId: ResourceId
  readonly ownerId: string
  /** Monotonically increases on every successful ownership change. */
  readonly fencingToken: number
  readonly expiresAt: string
}

export type LeaseDecision =
  | { readonly acquired: true; readonly lease: Lease }
  | { readonly acquired: false; readonly reason: 'owned' | 'idempotency-conflict' }

export interface LeaseStore {
  acquire(input: LeaseRequest): Promise<LeaseDecision>
  renew(leaseId: ResourceId, ownerId: string, fencingToken: number, ttlMs: number): Promise<Lease>
  release(leaseId: ResourceId, ownerId: string, fencingToken: number): Promise<void>
  isCurrent(leaseId: ResourceId, ownerId: string, fencingToken: number): Promise<boolean>
}

/* ---------------------------------------------------------------- memory */

export interface DurableHistoryEvent {
  readonly eventId: string
  readonly projectId: ProjectId
  readonly partitionId: string
  readonly sequence: number
  readonly occurredAt: string
  readonly type: string
  readonly payload: unknown
}

export interface AppendHistoryInput extends IdempotentCommand {
  readonly projectId: ProjectId
  readonly partitionId: string
  readonly event: Omit<DurableHistoryEvent, 'sequence' | 'projectId' | 'partitionId'>
}

export interface AppendHistoryResult {
  readonly appended: boolean
  readonly event: DurableHistoryEvent
}

export interface HistoryPageRequest {
  readonly projectId: ProjectId
  readonly partitionId: string
  readonly afterSequence?: number
  readonly limit: number
}

export interface DurableHistoryStore {
  /** Allocates sequence and appends under one atomic operation. */
  append(input: AppendHistoryInput): Promise<AppendHistoryResult>
  /** Requires a finite positive limit and returns a stable sequence cursor. */
  readPage(input: HistoryPageRequest): Promise<Page<DurableHistoryEvent>>
}

export type DurableHistoryRetention =
  | { readonly mode: 'retain-all' }
  | { readonly mode: 'delete-before'; readonly before: string; readonly approvedBy: string; readonly policyVersion: string }

export interface SearchableMemoryRecord {
  readonly id: string
  readonly projectId: ProjectId
  readonly tier: 'episode' | 'fact' | 'summary'
  readonly sourceEventId?: string
  readonly text: string
  readonly metadata: Readonly<Record<string, string | number | boolean>>
  readonly updatedAt: string
}

export interface SearchableMemoryQuery {
  readonly projectId: ProjectId
  readonly text?: string
  readonly tiers?: readonly SearchableMemoryRecord['tier'][]
  readonly limit: number
  readonly cursor?: Cursor
}

export interface SearchableMemoryStore {
  /** Upsert is idempotent on (projectId, id); source history is not mutated. */
  upsert(record: SearchableMemoryRecord): Promise<void>
  query(input: SearchableMemoryQuery): Promise<Page<SearchableMemoryRecord>>
  delete(projectId: ProjectId, ids: readonly string[], reason: string): Promise<number>
}

export interface ReindexCheckpoint {
  readonly projectId: ProjectId
  readonly source: string
  readonly sourceCursor: Cursor
  readonly embeddingFingerprint: string
  readonly completedRecords: number
  readonly updatedAt: string
}

export interface ReindexCheckpointStore {
  load(projectId: ProjectId, source: string, embeddingFingerprint: string): Promise<ReindexCheckpoint | undefined>
  save(checkpoint: ReindexCheckpoint): Promise<void>
  clear(projectId: ProjectId, source: string, embeddingFingerprint: string): Promise<void>
}

/* -------------------------------------------------------------- workspaces */

export type WorkspaceOperation = 'list' | 'read' | 'write' | 'execute' | 'collect'

export interface WorkspaceCapability {
  /** Opaque bearer material. Never log or persist this value in plaintext. */
  readonly token: string
  readonly capabilityId: ResourceId
  readonly projectId: ProjectId
  readonly taskId: TaskId
  readonly sessionId: SessionId
  readonly workspaceId: ResourceId
  /** Lease fencing token the provider must check on every operation. */
  readonly fencingToken: number
  readonly operations: readonly WorkspaceOperation[]
  /** Canonical workspace-relative prefixes. An empty array grants no path access; an empty-string prefix grants the workspace root. */
  readonly pathPrefixes: readonly string[]
  readonly expiresAt: string
}

export interface WorkspaceSession {
  readonly workspaceId: ResourceId
  readonly projectId: ProjectId
  readonly taskId: TaskId
  readonly sessionId: SessionId
  readonly provider: string
  readonly ownerId: string
  readonly state: 'creating' | 'ready' | 'transferring' | 'running' | 'closing' | 'closed' | 'failed' | 'unknown'
  readonly leaseId?: ResourceId
  readonly fencingToken?: number
  readonly createdAt: string
  readonly expiresAt: string
}

export interface CreateWorkspaceSessionInput extends IdempotentCommand {
  readonly workspaceId: ResourceId
  readonly ownerId: string
  readonly leaseId: ResourceId
  readonly fencingToken: number
  readonly projectId: ProjectId
  readonly taskId: TaskId
  readonly sessionId: SessionId
  readonly provider: string
  readonly ttlMs: number
  readonly signal?: AbortSignal
}

export interface WorkspaceSessionTransition {
  readonly workspaceId: ResourceId
  readonly ownerId: string
  readonly leaseId: ResourceId
  readonly fencingToken: number
  readonly expectedState: WorkspaceSession['state']
  readonly nextState: WorkspaceSession['state']
  readonly expiresAt?: string
}
 
export interface WorkspaceSessionAdoption {
  readonly workspaceId: ResourceId
  readonly expectedOwnerId: string
  readonly expectedLeaseId: ResourceId
  readonly expectedFencingToken: number
  readonly ownerId: string
  readonly leaseId: ResourceId
  readonly fencingToken: number
  readonly expiresAt: string
}

/** Durable session and capability metadata. Raw bearer tokens are never persisted. */
export interface WorkspaceSessionStore {
  /** Idempotently create one task-scoped session. Reusing a key with a different request is a conflict. */
  createSession(input: WorkspaceSession & { readonly ownerId: string; readonly idempotencyKey: string }): Promise<WorkspaceSession>
  getSession(workspaceId: ResourceId): Promise<WorkspaceSession | undefined>
  getTaskSession(projectId: ProjectId, taskId: TaskId, sessionId: SessionId): Promise<WorkspaceSession | undefined>
  listSessions(projectId: ProjectId, states?: readonly WorkspaceSession['state'][], limit?: number): Promise<readonly WorkspaceSession[]>
  /** Compare-and-set transition fenced by owner, lease ID, and monotonically increasing fencing token. */
  transitionSession(input: WorkspaceSessionTransition): Promise<WorkspaceSession>
  /** Adopt a prior session only after the old lease expired and the provider validated recovery; rotates the fence and revokes old capabilities. */
  adoptSession(input: WorkspaceSessionAdoption): Promise<WorkspaceSession>
  /** Store only a SHA-256 token digest and the capability's scope/expiry. */
  recordCapability(capability: WorkspaceCapability): Promise<void>
  /** Validate token, task/session/workspace binding, operation, path prefix, expiry, and revocation. */
  authorizeCapability(input: {
    readonly token: string
    readonly projectId: ProjectId
    readonly taskId: TaskId
    readonly sessionId: SessionId
    readonly workspaceId: ResourceId
    readonly operation: WorkspaceOperation
    readonly path?: string
    readonly now?: number
  }): Promise<boolean>
  revokeCapability(capabilityId: ResourceId, reason: string): Promise<void>
  revokeWorkspaceCapabilities(workspaceId: ResourceId, reason: string): Promise<void>
}

export interface WorkspaceCommand {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly timeoutMs: number
  readonly maxOutputBytes: number
  readonly signal?: AbortSignal
}

export interface WorkspaceCommandResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly stdoutBytes: number
  readonly stderrBytes: number
  readonly truncated: boolean
  readonly timedOut: boolean
  readonly aborted: boolean
}

/** Provider implementations must enforce capability scope and the current fencing token on every remote operation. */
export interface WorkspaceSessionProvider {
  readonly name: string
  create(input: CreateWorkspaceSessionInput): Promise<WorkspaceSession>
  issueCapability(input: {
    readonly workspaceId: ResourceId
    readonly projectId: ProjectId
    readonly fencingToken: number
    readonly taskId: TaskId
    readonly sessionId: SessionId
    readonly operations: readonly WorkspaceOperation[]
    readonly pathPrefixes: readonly string[]
    readonly ttlMs: number
  }): Promise<WorkspaceCapability>
  execute(workspaceId: ResourceId, capability: WorkspaceCapability, command: WorkspaceCommand): Promise<WorkspaceCommandResult>
  revoke(capabilityId: ResourceId, reason: string): Promise<void>
  close(input: {
    readonly workspaceId: ResourceId
    readonly reason: string
    readonly ownerId: string
    readonly leaseId: ResourceId
    readonly fencingToken: number
  }): Promise<{ readonly confirmed: boolean; readonly detail?: string }>
}

export interface WorkspaceSnapshotEntry {
  readonly path: string
  readonly kind: 'file' | 'directory'
  readonly sizeBytes: number
  readonly sha256?: string
  readonly mode?: number
}

export interface WorkspaceSnapshotManifest {
  readonly snapshotId: ResourceId
  readonly projectId: ProjectId
  readonly taskId: TaskId
  readonly entries: readonly WorkspaceSnapshotEntry[]
  readonly totalBytes: number
  readonly createdAt: string
}

export interface WorkspaceChange {
  readonly path: string
  readonly operation: 'create' | 'modify' | 'delete'
  readonly baseSha256?: string
  readonly resultSha256?: string
  readonly sizeBytes: number
}

export interface WorkspaceChangeSet {
  readonly workspaceId: ResourceId
  readonly snapshotId: ResourceId
  readonly changes: readonly WorkspaceChange[]
  readonly totalBytes: number
}

/**
 * Transfer limits are mandatory at every boundary. Providers must reject invalid,
 * non-finite, zero, or over-policy limits before reading or writing any bytes.
 */
export interface WorkspaceTransferLimits {
  readonly maxFiles: number
  readonly maxFileBytes: number
  readonly maxTotalBytes: number
  readonly chunkBytes: number
}

/** A single bounded chunk. Providers must not buffer an entire file to yield it. */
export interface WorkspaceTransferChunk {
  readonly offset: number
  readonly bytes: Uint8Array
}

/** File content is streamed; callers must verify the declared size and SHA-256. */
export interface WorkspaceTransferFile {
  readonly path: string
  readonly sizeBytes: number
  readonly sha256: string
  readonly chunks: AsyncIterable<WorkspaceTransferChunk>
}

export interface WorkspaceTransferScope {
  readonly workspaceId: ResourceId
  readonly projectId: ProjectId
  readonly taskId: TaskId
  readonly sessionId: SessionId
  readonly capability: WorkspaceCapability
  readonly fencingToken: number
}

export interface WorkspaceApplyRequest {
  readonly scope: WorkspaceTransferScope
  readonly snapshotId: ResourceId
  /** Changes must be sorted by canonical path and contain no duplicate paths. */
  readonly changes: readonly WorkspaceChange[]
  readonly files: AsyncIterable<WorkspaceTransferFile>
  readonly maxFiles: number
  readonly maxTotalBytes: number
}

export type WorkspaceApplyResult =
  | { readonly applied: true; readonly appliedPaths: readonly string[] }
  | { readonly applied: false; readonly reason: 'conflict' | 'invalid-manifest' | 'limit-exceeded' | 'unauthorized' | 'stale-fence'; readonly paths?: readonly string[] }

export interface WorkspaceTransferProvider {
  /** Creates metadata only. File bytes are read separately through readSnapshotFile. */
  createSnapshot(input: {
    readonly projectId: ProjectId
    readonly taskId: TaskId
    readonly maxFiles: number
    readonly maxTotalBytes: number
  }): Promise<WorkspaceSnapshotManifest>
  /** Streams one file in monotonically increasing, contiguous, bounded chunks. */
  readSnapshotFile(input: WorkspaceTransferScope & {
    readonly snapshotId: ResourceId
    readonly path: string
    readonly maxBytes: number
    readonly chunkBytes: number
  }): Promise<WorkspaceTransferFile>
  /** Uploads only validated manifest entries; implementations must verify size and digest while streaming. */
  uploadSnapshot(input: WorkspaceTransferScope & {
    readonly manifest: WorkspaceSnapshotManifest
    readonly files: AsyncIterable<WorkspaceTransferFile>
    readonly limits: WorkspaceTransferLimits
  }): Promise<void>
  /** Returns metadata only. Changed file bytes are read separately through readChangeFile. */
  collectChanges(input: WorkspaceTransferScope & {
    readonly snapshotId: ResourceId
    readonly maxFiles: number
    readonly maxTotalBytes: number
  }): Promise<WorkspaceChangeSet>
  readChangeFile(input: WorkspaceTransferScope & {
    readonly snapshotId: ResourceId
    readonly path: string
    readonly maxBytes: number
    readonly chunkBytes: number
  }): Promise<WorkspaceTransferFile>
  /**
   * Applies a complete change set atomically. The provider must recheck capability,
   * path policy, and fencing immediately before commit, compare base hashes, and
   * apply no paths when any conflict or validation failure exists.
   */
  applyChanges(input: WorkspaceApplyRequest): Promise<WorkspaceApplyResult>
}

/* ----------------------------------------------------------- schema safety */

export interface AppliedMigration {
  readonly version: number
  readonly id: string
  readonly checksum: string
  readonly appliedAt: string
}

export interface MigrationPlan {
  readonly targetVersion: number
  readonly pending: readonly { readonly version: number; readonly id: string; readonly checksum: string }[]
  readonly currentVersion: number
}

export interface MigrationCoordinator {
  /** Inspection is read-only and must not mutate schema or data. */
  plan(targetVersion?: number): Promise<MigrationPlan>
  /** Applies each migration and its ledger row atomically, in version order. */
  apply(plan: MigrationPlan): Promise<readonly AppliedMigration[]>
  /** Refuses unknown, missing, reordered, or checksum-changed applied migrations. */
  verify(): Promise<void>
}
