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
  readonly operations: readonly WorkspaceOperation[]
  /** Canonical workspace-relative prefixes; empty means no path access. */
  readonly pathPrefixes: readonly string[]
  readonly expiresAt: string
}

export interface WorkspaceSession {
  readonly workspaceId: ResourceId
  readonly projectId: ProjectId
  readonly taskId: TaskId
  readonly sessionId: SessionId
  readonly provider: string
  readonly state: 'creating' | 'ready' | 'transferring' | 'running' | 'closing' | 'closed' | 'failed' | 'unknown'
  readonly leaseId?: ResourceId
  readonly fencingToken?: number
  readonly createdAt: string
  readonly expiresAt: string
}

export interface CreateWorkspaceSessionInput extends IdempotentCommand {
  readonly projectId: ProjectId
  readonly taskId: TaskId
  readonly sessionId: SessionId
  readonly provider: string
  readonly ttlMs: number
  readonly signal?: AbortSignal
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

export interface WorkspaceSessionProvider {
  readonly name: string
  create(input: CreateWorkspaceSessionInput): Promise<WorkspaceSession>
  issueCapability(input: {
    readonly workspaceId: ResourceId
    readonly taskId: TaskId
    readonly sessionId: SessionId
    readonly operations: readonly WorkspaceOperation[]
    readonly pathPrefixes: readonly string[]
    readonly ttlMs: number
  }): Promise<WorkspaceCapability>
  execute(workspaceId: ResourceId, capability: WorkspaceCapability, command: WorkspaceCommand): Promise<WorkspaceCommandResult>
  revoke(capabilityId: ResourceId, reason: string): Promise<void>
  close(workspaceId: ResourceId, reason: string): Promise<{ readonly confirmed: boolean; readonly detail?: string }>
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

export interface WorkspaceTransferProvider {
  createSnapshot(input: {
    readonly projectId: ProjectId
    readonly taskId: TaskId
    readonly maxFiles: number
    readonly maxBytes: number
  }): Promise<WorkspaceSnapshotManifest>
  uploadSnapshot(workspaceId: ResourceId, manifest: WorkspaceSnapshotManifest): Promise<void>
  collectChanges(workspaceId: ResourceId, snapshotId: ResourceId, maxBytes: number): Promise<WorkspaceChangeSet>
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
