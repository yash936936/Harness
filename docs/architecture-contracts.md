# Architecture contracts and migration safety

Status: Phase 1 contract baseline. This document defines boundaries, not a production implementation. The type-only contracts live in `src/architecture/contracts.ts`. Existing runtime behavior, public APIs, providers, and persisted formats are unchanged.

## Scope and constraints

- SQLite is the first selected transactional backend, behind domain interfaces.
- The approved sandbox direction is capability-based task sessions added beside the existing one-shot provider contract.
- Durable append-only history is separate from bounded searchable memory.
- Existing public APIs, providers, and persisted formats remain compatible during migration.
- D-110, D-117, and D-118 remain binding. No host fallback, Docker/WSL/Crabbox work, implicit provider selection, or coding-profile `run_command` exposure is allowed.
- The four D-119 owner decisions are approved and binding: multi-process/single-host operation on supported local filesystems, one SQLite database per project, no automatic durable-history deletion, and crash resume only after lease expiry, explicit ownership acquisition, and provider-validated recovery.

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

### Captured baseline: 2026-11-14

CI run #732, Ubuntu x64, Node v22.12.0, 4 CPUs. Five samples per measurement. Times are milliseconds.

| Operation | Dataset | p50 | p95 |
|---|---:|---:|---:|
| Session-log append | 0 events | 1.128 | 2.329 |
| Session-log append | 50,000 events | 45.353 | 65.068 |
| Session-log append | 100,000 events | 82.867 | 90.514 |
| Episodic duplicate check | 100,000 episodes | 265.950 | 289.235 |
| Episodic selective query | 100,000 episodes | 133.019 | 134.148 |

### Additional local baseline: Windows — 2026-11-14

Owner-run local measurement on Windows x64, Node v22.18.0, 8 CPUs, 8,311,836,672 bytes total memory. Five samples per measurement. These results are separate from CI run #732 and must not be pooled with the Ubuntu measurements above.

| Operation | Dataset | p50 | p95 |
|---|---:|---:|---:|
| Session-log append | 0 events | 13.924 | 20.029 |
| Session-log append | 50,000 events | 139.597 | 161.421 |
| Session-log append | 100,000 events | 285.722 | 386.580 |
| Episodic duplicate check | 100,000 episodes | 385.165 | 654.968 |
| Episodic selective query | 100,000 episodes | 207.657 | 242.362 |

The 100k session fixture was 25,788,895 bytes; the episodic fixture was 27,635,492 bytes. The process-wide observed RSS delta was 485,298,176 bytes (~463 MiB), including fixture generation. It is not attributable to one operation. As above, p95 is the maximum of five samples, not a stable tail-latency estimate. Compare only with measurements on a matching OS/runtime/hardware class.

### Independent-process reservation baseline: CI run #744

Ubuntu x64, Node v22.12.0, 4 CPUs. Five samples per process count. Every worker loaded the same persisted daily-budget state file, then attempted to reserve one request after a parent-controlled barrier. The configured daily hard limit was one request. Startup includes worker process creation and module initialization; contention is measured from barrier release until all workers report their reservation result.

| Independent processes | Accepted p50 | Rejected p50 | Excess over hard limit p50 | Startup p50 / p95 ms | Reservation window p50 / p95 ms |
|---:|---:|---:|---:|---:|---:|
| 2 | 2 | 0 | 1 | 269.340 / 275.330 | 0.942 / 1.266 |
| 4 | 4 | 0 | 3 | 453.140 / 463.176 | 3.092 / 6.968 |
| 8 | 8 | 0 | 7 | 846.705 / 882.811 | 6.915 / 9.724 |

All workers were accepted in all five samples at each process count. This is the expected baseline for the current implementation: `Budgets.reserve()` stores held capacity in process memory and does not persist reservations. The shared daily-state file therefore does not coordinate in-flight reservations between processes. This measurement confirms the known oversubscription limitation; it is not a successful shared-reservation result. Phase 2 acceptance must reduce oversubscription to zero using transactional shared state.

The process-startup and reservation-window timings are specific to this GitHub-hosted runner. The reservation-window timings are not SQLite transaction latency and should not be used as a target for the future backend.

Fixture sizes: session log 25,788,895 bytes at 100k events; episodic store 27,635,492 bytes at 100k episodes. The benchmark reports file-size-based read-volume estimates, not OS-level I/O counters. At 100k records, the implementation's append path reads the session file; duplicate checking reads the episodic store twice in this code path; selective query reads it once.

Peak observed RSS delta was 551,690,240 bytes (~526 MiB), but fixture generation contributes materially to this process-wide peak. Do not attribute it to one store operation.

The runner uses five samples, so p95 is the maximum observed sample, not a statistically stable tail-latency estimate. Results are an initial reproducible baseline, not a performance target. Compare future changes on the same runner class and increase sample count for release-quality tail estimates.

### Deterministic indexing baseline: CI run #749

Ubuntu x64, Node v22.12.0, 4 CPUs. Three sequential samples in one process. The fixture contains 30 TypeScript files with 40 exported functions each, plus one 540-function file. All 1,740 chunks were embedded and indexed. The large file alone exceeds the configured 512-chunk embedding-group threshold.

| Measurement | p50 | Maximum of 3 samples |
|---|---:|---:|
| `indexFiles` elapsed time | 306.759 ms | 403.469 ms |
| Throughput | 5,672.2 chunks/s | 5,783.4 chunks/s |
| Process RSS delta | 24,248,320 bytes | 120,786,944 bytes |

Each sample indexed 31 files and 1,740 chunks and made 7 embedding calls. The elapsed timer covers `indexFiles` only; fixture creation, parser/WASM warmup, and LanceDB module loading are outside the timed interval. RSS sampling runs every 5 ms during setup and indexing, so it is process-wide, can miss short-lived peaks, and includes setup. Samples run sequentially in one process; retained heap from earlier samples can affect later RSS deltas. The maximum of three samples is not a statistically stable p95.

This measures the current implementation, not bounded-memory indexing. `indexFiles` prepares all file chunks before embedding groups; `indexGroupChunks` bounds an embedding group, not total prepared memory. Hashing embeddings are deterministic local test infrastructure and provide no semantic-quality evidence.

### Deterministic semantic reindex baseline: CI run #752

Ubuntu x64, Node v22.12.0, 4 CPUs. Three sequential samples in one process. Each sample reindexed 2,000 persisted semantic facts into a fresh LanceDB collection using deterministic local 64-dimensional hashing embeddings. The embedding provider was configured for batches of 64 facts.

| Measurement | p50 | Maximum of 3 samples |
|---|---:|---:|
| `MemorySemantic.reindex({ reset: true })` elapsed time | 78.332 ms | 142.656 ms |
| Throughput | 25,532.5 facts/s | 27,627.7 facts/s |
| Process RSS delta | 5,005,312 bytes | 75,137,024 bytes |

Every sample indexed 2,000 facts and verified 2,000 vectors. Each made 32 embedding requests: 31 batches of 64 and one batch of 16. The current implementation performs one vector collection upsert containing all 2,000 records.

Fixture generation and LanceDB module loading are outside the timed interval. RSS is sampled every 5 ms during setup and reindex; it is process-wide, includes setup, and can miss short-lived peaks. Samples run sequentially in one process, so retained heap and native allocations from earlier samples can affect later RSS deltas. The maximum of three samples is not a statistically stable p95.

This measures the current all-at-once reindex path, not a resumable or bounded-memory implementation. Embedding provider requests are batched, but the full fact-text list, returned vector list, and vector-record list remain materialized before the single upsert. Hashing embeddings are deterministic local test infrastructure and provide no semantic-quality evidence.

### Output capture baseline: Vercel adapter contract

A deterministic fake-client workload is now wired into architecture CI. It tests 99,000, 100,000, 1,000,000, and 8,000,000 ASCII characters on each of stdout and stderr, with a 100,000-byte cap per returned stream. It records elapsed time, observed process RSS delta, returned byte counts, truncation, and sandbox cleanup. CI run #759, Ubuntu x64, Node v22.12.0, 4 CPUs. Three samples per size. Times are milliseconds; RSS values are bytes.

| Source characters per stream | Elapsed p50 / max | Observed RSS delta p50 / max |
|---:|---:|---:|
| 99,000 | 17.312 / 23.943 | 10,092,544 / 10,223,616 |
| 100,000 | 11.248 / 12.494 | 2,621,440 / 7,602,176 |
| 1,000,000 | 12.892 / 19.426 | 3,801,088 / 4,063,232 |
| 8,000,000 | 24.942 / 25.592 | 16,011,264 / 20,262,912 |

For inputs above the 100,000-byte cap, each returned stream contains 100,038 bytes: the 100,000-byte payload plus the 38-byte truncation marker. At or below the cap, output is returned unchanged. The test verifies independent truncation and confirmed sandbox deletion in every sample.

The fake client explicitly materializes both complete strings before returning them. The 8 MB-per-stream case therefore supplies 16 MB of source output per invocation while the adapter returns about 100 KB per stream. RSS is sampled every 5 ms and explicitly after each complete string is materialized. RSS is process-wide and can still miss transient allocation peaks; sequential samples share one process. Three-sample maxima are not stable tail estimates. These numbers characterize the adapter and fake string source, not the real Vercel SDK's internal buffers or remote execution.

This is explicitly an output-capture/truncation baseline, not a streaming-output benchmark. The current `VercelSandboxHandle` contract exposes `stdout(): Promise<string>` and `stderr(): Promise<string>`; both complete strings are materialized before the adapter applies its cap. The interface has no chunk iterator or readable stream, so the adapter cannot bound SDK-side buffering, enforce a byte limit while data arrives, or stop an endless output stream. The fake client does not establish how the real SDK buffers output internally. A streaming contract and provider implementation change are required before bounded streaming acceptance can be measured.

No numeric estimate is substituted for the missing streaming behavior.

| Area | Baseline workload | Required measurements |
|---|---|---|
| Session log | 100k events in one session; append at beginning/middle/end of run | Append latency, bytes read per append, recovery time, peak RSS |
| Episodic memory | 100k episodes with duplicate and selective queries | Duplicate-check cost, query latency, rows scanned, peak RSS |
| Reservations | Concurrent independent processes contending for one hard limit | Accepted/rejected count, oversubscription count (must be zero), wait time |
| Indexing | Small files plus one file larger than the configured chunk batch | Peak RSS, batch size, throughput, cancellation latency |
| Semantic reindex | 2,000 persisted facts, deterministic 64-dimensional embeddings, 64-item provider batches | Reindex latency, throughput, embedding request/batch counts, vector count, peak RSS |\n| Output capture | 99k/100k/1M/8M ASCII characters per stream, two streams, 100k returned-byte cap | Adapter latency, process RSS observation, returned bytes, truncation and cleanup; does not measure SDK-internal buffering or endless streams |



The current-code baseline runner is `npm run bench:architecture` (also executed by the `architecture performance baseline` CI job). It records Node/platform/CPU metadata, fixture sizes, p50/p95 timings, file-size-based read-volume estimates, and observed RSS. It measures session-log append at 0/50k/100k events, episodic duplicate-check/selective-query at 100k episodes, independent-process reservations, deterministic indexing, and semantic reindex. Bounded streaming-output measurements remain unmeasured; do not fill that row with estimates or in-process substitutes.

## Approved deployment and operating policy

The four D-119 owner decisions are approved and binding for the initial implementation:

1. **Deployment topology:** support multiple Harness processes on one host using a supported local filesystem. Multi-machine shared-state operation and arbitrary network filesystems are out of scope until separately designed and approved.
2. **Database ownership:** use one SQLite database per project. Do not use a shared cross-project database in this implementation.
3. **Durable-history retention:** retain durable history indefinitely by default. Do not automatically delete it. Any retention period or deletion workflow requires a separately specified and approved policy.
4. **Workspace crash recovery:** another process may resume a crashed workspace only after the prior lease has expired, ownership is explicitly acquired, and the provider validates recoverability. If any condition cannot be established, create a fresh workspace. Lease expiry alone is not proof that recovery is safe.

These choices are recorded as binding D-119 policy in `docs/decisions.md`. Phase 2 implementation and tests must enforce them. Changing any choice requires a new decision record and migration review.
