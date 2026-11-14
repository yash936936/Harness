# Architecture contracts and migration safety

Status: Phase 1 contract baseline. This document defines boundaries, not a production implementation. The type-only contracts live in `src/architecture/contracts.ts`. Existing runtime behavior, public APIs, providers, and persisted formats are unchanged.

## Scope and constraints

- SQLite is the first selected transactional backend, behind domain interfaces.
- The approved sandbox direction is capability-based task sessions added beside the existing one-shot provider contract.
- Durable append-only history is separate from bounded searchable memory.
- Existing public APIs, providers, and persisted formats remain compatible during migration.
- D-110, D-117, and D-118 remain binding. No host fallback, Docker/WSL/Crabbox work, implicit provider selection, or coding-profile `run_command` exposure is allowed.
- The deployment topology, database ownership, durable-history deletion policy, and crashed-workspace recovery policy remain approval gates. No provisional default is treated as a decision.

## Domain boundaries

| Contract | Owns | Required invariant |
|---|---|---|
| `BudgetReservationStore` | Request/token/byte/operation reservations | Check committed usage plus live reservations atomically. Settle/release idempotently. |
| `RateLimitStore` | Sliding-window attempts and concurrency permits | Window accounting and permit acquisition are one transaction. Expired permits are reclaimed safely. |
| `LeaseStore` | Ownership of shared resources | Every ownership change increments a fencing token. Stale owners cannot renew, release, or commit. |
| `DurableHistoryStore` | Append-only project/partition events | Sequence allocation and append are atomic. Duplicate idempotency keys do not create duplicate events. Reads are cursor-paged. |
| `SearchableMemoryStore` | Episodes, facts, summaries and other projections | Bounded query results. Rebuildable from durable sources. Deletion never silently mutates durable history. |
| `ReindexCheckpointStore` | Reindex progress | Checkpoints bind source cursor and embedding fingerprint. Resume cannot mix incompatible embeddings. |
| `WorkspaceSessionProvider` | Task-scoped remote workspace lifecycle | Capabilities bind project/task/session/workspace, operations, path prefixes and expiry. Revocation and close are explicit. |
| `WorkspaceTransferProvider` | Snapshot upload and bounded change collection | Manifest is deterministic; paths, symlinks, secrets, counts and bytes are validated before transfer. Collected changes are not applied automatically. |
| `MigrationCoordinator` | Schema migration ledger and execution | Plan is read-only; each migration and ledger update are atomic; checksum drift fails closed. |

## Transaction and concurrency rules

1. A domain operation with an idempotency key must return the prior result for the same key and same payload. The same key with a different payload is a conflict.
2. Budget reservations, rate-limit permits, and lease ownership changes must be serialized by the backend. A read-then-write sequence outside one transaction is not valid.
3. Lease renewal and mutation require the current owner and fencing token. A process that resumes after lease expiry must not be able to commit stale work.
4. TTL cleanup is bounded and safe to repeat. Expired reservations and permits cannot count as live capacity.
5. No cross-domain operation may pretend to be one atomic transaction unless all participating records share the same transaction boundary. Otherwise use an explicit state machine and compensating/recovery steps.

## Durable history and searchable memory

- Durable events are append-only and partitioned by project and logical stream.
- Sequence assignment and append commit together.
- Reads require a finite page limit and stable cursor/sequence ordering.
- Searchable memory is a projection. It may be rebuilt, compacted, or pruned independently.
- Retention/deletion of durable history requires a separately approved policy, an auditable actor/reason, and a versioned policy identifier.
- Reindex checkpoints include source position and embedding fingerprint. A changed embedding model starts a new index generation or an explicitly approved migration; it must not silently mix vectors.

## Workspace capability and transfer rules

- A workspace session is scoped to one project, task and session.
- Capability tokens are opaque bearer secrets. Persist only a verifier/hash where persistence is needed; never log token material.
- Capabilities have explicit operations, canonical relative path prefixes, expiry and revocation.
- Every operation validates capability scope at the provider boundary. Caller-side checks alone are insufficient.
- Workspace transfer uses a deterministic manifest with file count and byte limits, hashes, normalized paths, and explicit exclusions.
- Symlinks, traversal, credential stores, sockets, and secret-bearing paths are rejected or excluded before upload.
- Change collection returns a bounded manifest and content hashes. It does not directly modify the user's project. Conflict detection, policy approval and the existing governed write path decide whether changes may be applied.
- Cleanup failure is observable and leaves the session in an uncertain/failure state. It must not be reported as successfully closed.

## Compatibility and migration rules

1. Introduce new contracts and adapters without changing existing interfaces.
2. Keep the one-shot `SandboxProvider` API operational. Do not emulate persistence by creating a new sandbox for each command and calling it a session.
3. Read existing persisted formats during migration. Do not rewrite them in place until backup, rollback, and recovery have been tested.
4. Avoid dual writes. If an unavoidable transition requires them, define one authoritative source, replay order, idempotency key, divergence detection, and a bounded reconciliation procedure first.
5. Migrations are ordered, checksummed and versioned. Unknown versions or checksum drift stop startup rather than guessing.
6. A migration plan is inspectable and read-only. Backups are verified before destructive or format-changing steps.
7. Rollback is supported only where the migration declares it safe. Otherwise recovery is forward-only from a verified backup.
8. Each rollout has a feature gate and a rollback trigger. Do not remove the old adapter until production evidence and compatibility tests pass.

## Migration sequence

| Step | Change | Compatibility strategy | Exit evidence |
|---|---|---|---|
| 1 | Add backend-neutral contracts | Type-only additions; no runtime wiring | Typecheck and contract review |
| 2 | Add SQLite schema ledger and transaction layer | New isolated store; existing JSON/file stores remain authoritative | Migration, backup, checksum and corruption tests |
| 3 | Move budget reservations | One authoritative store per rollout; explicit cutover | Independent-process oversubscription tests |
| 4 | Move rate limits and leases | Preserve public limiter/provider facades through adapters | Race, expiry, fencing and crash-recovery tests |
| 5 | Optimize durable history and episodic memory | Read old formats; build indexes as rebuildable sidecars | 100k-event append/query and torn-tail tests |
| 6 | Bound searchable memory and reindex | Durable source retained; versioned projection generations | Paging, quota, interruption and resume tests |
| 7 | Add workspace sessions and transfer | Optional capability interface beside one-shot API | Isolation, revocation, path, transfer and cleanup tests |
| 8 | Enforce streaming output caps | Preserve existing result shape and truncation semantics | Bounded peak-buffer tests and provider contract suite |

## Failure and recovery matrix

| Failure point | Required behavior |
|---|---|
| Process dies before transaction commit | Transaction rolls back; retry with same idempotency key is safe. |
| Process dies after commit but before response | Retry returns the committed result, not a second reservation/event/lease. |
| Lease expires while old owner is paused | New owner receives a higher fencing token; old owner cannot commit. |
| SQLite reports busy/locked | Bounded retry with jitter and cancellation; then a typed failure. Never spin forever or silently fall back to files. |
| Database is corrupt or migration checksum differs | Fail closed; preserve the original file; require verified restore or explicit repair. |
| Memory index is incomplete | Rebuild from durable history using a checkpoint; do not claim the projection is current. |
| Workspace create is cancelled while provider creation is pending | Await creation outcome; if a workspace appears, attempt confirmed cleanup and surface cleanup failure. |
| Snapshot upload or result collection is interrupted | Keep an explicit incomplete state; retry idempotently from manifest/hash checkpoints. |
| Result conflicts with local changes | Do not overwrite. Return conflict metadata for the governed approval/write path. |

## Baseline and verification plan

No performance numbers are claimed in this contract-only phase. Capture a reproducible baseline before each corresponding migration, using fixed fixtures and recording runtime, Node version, OS, hardware class, dataset size, warm/cold state, p50/p95, bytes read/written, peak RSS, and result correctness.

| Area | Baseline workload | Required measurements |
|---|---|---|
| Session log | 100k events in one session; append at beginning/middle/end of run | Append latency, bytes read per append, recovery time, peak RSS |
| Episodic memory | 100k episodes with duplicate and selective queries | Duplicate-check cost, query latency, rows scanned, peak RSS |
| Reservations | Concurrent independent processes contending for one hard limit | Accepted/rejected count, oversubscription count (must be zero), wait time |
| Indexing | Small files plus one file larger than the configured chunk batch | Peak RSS, batch size, throughput, cancellation latency |
| Output | Under/at/over-cap output and endless stream | Peak buffered bytes, termination latency, truncation correctness |

## Approved deployment and operating policy

The four D-119 owner decisions are approved and binding for the initial implementation:

1. **Deployment topology:** support multiple Harness processes on one host using a supported local filesystem. Multi-machine shared-state operation and arbitrary network filesystems are out of scope until separately designed and approved.
2. **Database ownership:** use one SQLite database per project. Do not use a shared cross-project database in this implementation.
3. **Durable-history retention:** retain durable history indefinitely by default. Do not automatically delete it. Any retention period or deletion workflow requires a separately specified and approved policy.
4. **Workspace crash recovery:** another process may resume a crashed workspace only after the prior lease has expired, ownership is explicitly acquired, and the provider validates recoverability. If any condition cannot be established, create a fresh workspace. Lease expiry alone is not proof that recovery is safe.

These choices are recorded as binding D-119 policy in `docs/decisions.md`. Phase 2 implementation and tests must enforce them. Changing any choice requires a new decision record and migration review.
