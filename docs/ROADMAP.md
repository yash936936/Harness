# Roadmap: Harness audit closeout and scalable architecture

Updated 2026-11-14. This is the active implementation roadmap. Current project state and binding constraints are in [STATE.md](STATE.md); architecture decisions are in [decisions.md](decisions.md); detailed findings are tracked in [CODEBASE-AUDIT-CHECKLIST.md](CODEBASE-AUDIT-CHECKLIST.md).

## Target outcome

Complete the current security and reliability audit, then migrate Harness toward shared transactional state, bounded memory, task-scoped workspace sessions, and safe output collection without breaking existing public APIs or providers.

## Binding architecture decisions

- **Shared state:** SQLite first, behind a storage interface. Initial scope is multiple processes on one machine and a supported local filesystem. No multi-machine guarantee.
- **Sandbox:** capability-based, task-scoped workspace sessions added alongside the one-shot sandbox API.
- **Memory:** hybrid retention. Durable append-only history is authoritative; bounded searchable memory and vector indexes are rebuildable projections.
- **Compatibility:** preserve public APIs, existing provider contracts, persisted data, and caller-visible behavior through adapters and incremental migration.
- **Initial defaults:** one SQLite database per project; no automatic deletion of durable history until retention policy is approved; workspace resume requires explicit lease ownership and validated provider recovery.
- **Security:** D-110, D-117, and D-118 remain binding. No Docker/WSL/Crabbox, no host command fallback, no automatic sandbox provider selection, and no coding-profile `run_command` exposure before the existing acceptance requirements are met.

## Open audit work

| Priority | Findings | Required work |
|---|---|---|
| P1 | AUD-007, AUD-008 | Remove full-history work from session-log append and episodic-memory append/duplicate paths. Add sequence/offset indexes and indexed identity lookup with rebuild/recovery. |
| P1 | AUD-015, AUD-044 | Replace process-local budget, rate-limit, and concurrency reservations with transactional shared state. |
| P1 | AUD-021, AUD-039 | Fix late sandbox-create cancellation so cleanup is awaited and failures are surfaced; add task-scoped workspace sessions, capability checks, lease ownership, safe transfer, result synchronization, and verified cleanup. |
| P2 | AUD-014, AUD-025 | Define durable-history policy and bounded searchable-memory quotas, paging, retention, batched embeddings, and resumable reindexing. |
| P2 | AUD-016 | Bound indexing memory, including large single files; measure vector search and decide whether/when ANN is justified. |
| P2 | AUD-023 | Enforce output byte limits while streaming or through a verified SDK-side cap, with cancellation and bounded buffering. |
| P2 | Audit remainder | Finish the incomplete file-by-file audit, verify each status against code and tests, and correct stale or unsupported register claims. |

Withdrawn findings AUD-009, AUD-022, and AUD-027 must remain withdrawn unless new evidence changes the conclusion. Do not reopen them based on the old descriptions alone.

## Implementation phases

### Phase 0: CI and audit-branch stabilization

- Fix every failing test in the current PR matrix without weakening security boundaries.
- Keep Node 20.19.0 and 22.12.0 coverage on Ubuntu and Windows.
- Verify typecheck, lint, complete test suite, docs drift, full Markdown links, secret scan, dependency audit, license inventory, and `ci-pass`.
- Review Windows-specific file identity and lock behavior. Do not treat skipped tests as passing coverage.
- Correct audit-register claims that are not supported by the actual diff or tests.

**Exit:** all required CI jobs pass on the latest PR head; no acceptance claim is made for live sandbox/model work.

### Phase 1: Architecture contracts and migration safety

- Define small domain interfaces for shared state, budget reservations, rate limits, task leases, memory history, searchable memory, and workspace sessions.
- Record ownership, transaction, idempotency, expiry, recovery, and compatibility rules.
- Define schema versioning, backup, migration, rollback, and reconciliation strategy.
- Establish baseline performance measurements for append, query, reservation, indexing, and output collection.

**Exit:** contracts and migration invariants reviewed; no production behavior changed.

### Phase 2: SQLite shared-state foundation

- Add SQLite provider and versioned migrations.
- Add transaction helpers, bounded busy handling, constraints, and recovery.
- Migrate budget reservations first, then rate-limit and concurrency reservations, then workspace lease metadata.
- Ensure one authoritative write path at each migration stage; do not perform uncoordinated dual writes.
- Keep the provider interface independent of SQLite so a server database can be added if deployment topology changes.

**Exit:** independent-process tests prove budgets and rate limits cannot be oversubscribed; migration and recovery tests pass.

### Phase 3: Durable history and bounded memory

- Make session-log append avoid full-history scans; maintain sequence state and rebuildable offsets.
- Repair torn tails only during recovery or explicit integrity checks, not on every append.
- Add indexed episodic identity/duplicate checks and paginated queries.
- Separate durable event history from searchable memory.
- Add configurable quotas, retention, cursor paging, bounded session maps, and bounded embedding batches.
- Make vector reindexing checkpointed, resumable, and rebuildable.

**Exit:** scale tests show bounded per-operation reads and memory use; deletion and retention behavior is documented and tested.

### Phase 4: Capability-based workspace sessions

- Add workspace session interfaces alongside the existing one-shot `run(command)` API.
- Issue opaque task/session-bound capabilities with explicit operations, path scopes, expiry, and revocation.
- Implement provider adapters without silently emulating persistence through a new sandbox per command.
- Persist lease ownership and lifecycle metadata in SQLite.
- Add safe snapshot/transfer manifests, secret exclusion, path and symlink validation, conflict detection, and atomic result acceptance.
- Keep `run_command` unavailable in the coding profile until workspace transfer, result synchronization, lifecycle audit, and policy integration pass.

**Exit:** provider contract, capability isolation, lease recovery, transfer, cancellation, and cleanup tests pass. Live acceptance remains a separate owner-run gate.

### Phase 5: Streaming output enforcement

- Count output bytes as chunks arrive.
- Bound buffered stdout/stderr independently where required by the public contract.
- Cancel or terminate the operation at the configured cap.
- Preserve truncation metadata and deterministic timeout/cancellation behavior.
- Test UTF-8 boundaries, oversized chunks, endless streams, and provider read failures.

**Exit:** tests demonstrate bounded peak buffering, not just bounded returned strings.

### Phase 6: Integration, compatibility, and audit closeout

- Test SQLite reservations with memory writes and workspace lease transitions.
- Test crashes between reservation, execution, transfer, and commit.
- Test idempotent retries and recovery from partial writes.
- Run the existing public API and provider contract suites unchanged where possible.
- Finish the complete file-by-file and cross-folder audit.
- Update generated docs, component docs, state, decisions, audit register, and this roadmap.

**Exit:** supported CI matrix green, compatibility preserved, no unexplained open P1 findings, and every remaining P2 has an owner and acceptance condition.

### Phase 7: Existing cloud prototype acceptance

This remains separate from architecture CI and must follow D-117/D-118:

- Build a deterministic, secret-safe project snapshot.
- Implement validated result synchronization and conflict handling.
- Add provider lifecycle audit and verified cleanup.
- Integrate Vercel explicitly only after those controls pass.
- Keep sandbox network deny-all by default and use separate explicit consent for model and sandbox egress.
- Complete owner-run S4 evidence; fake SDK tests and CI do not count as live acceptance.
- Complete S6/S7 only with the evidence rules in [STATE.md](STATE.md) and D-109.

## Required test matrix

| Area | Required tests |
|---|---|
| SQLite | Independent processes, concurrent reservations, rollback, busy timeout, idempotency, expiry, schema upgrade, corruption/recovery, symlink/path safety |
| Memory | 100k-event append scaling, torn-tail recovery, duplicate index, bounded pagination, quota behavior, batch limits, interrupted/restarted reindex |
| Workspace | Cross-task capability denial, read-only enforcement, expiry/revocation, path traversal, symlink escape, interrupted transfer, conflict, cancellation, cleanup failure |
| Output | Below/at/above cap, large chunk, multibyte UTF-8, endless output, stdout/stderr limits, timeout and abort |
| Compatibility | Existing public APIs, existing one-shot providers, config defaults, persisted formats, caller-visible errors |
| CI/security | Node 20.19.0 and 22.12.0 on Ubuntu/Windows, typecheck, lint, tests, docs, secrets, dependencies, licenses |

## Explicitly out of scope

- Docker/WSL/Crabbox and S0/S1 work under D-110.
- Host command execution or local subprocess fallback in the coding profile.
- Enabling `run_command` before D-118 acceptance.
- Multi-machine shared-state guarantees in the SQLite phase.
- Replacing LanceDB or adopting ANN without measured need.
- Breaking public API migration.
- Package/release/distribution, desktop application, Qwen 7B artifacts, or other scope excluded by existing decisions.

## Definition of done

The audit is closed only when all P1 findings are fixed and verified, the remaining file inventory is actually reviewed, supported CI is green, and every P2 item is fixed or explicitly deferred with a reason and acceptance test. Architecture phases advance only on their exit evidence. Never describe CI, fake-provider tests, or a design document as live sandbox acceptance or production readiness.
