# Roadmap: Harness audit closeout and scalable architecture

## 2026-11-21 unified completion loop: current status

Main baseline: `d0c2639a834841e70002a3e32f1b5068ac15d2ef` (PR #165 merged). Post-merge main CI run #44837164572 is in progress; PR-head CI #44836850401 passed all mandatory jobs.

**Completed and verified**
- PR #156: semantic insertion-order/tombstone fix; post-merge CI #44827470725 passed.
- PR #157: performance evidence, roadmap updates, and explicit informational-only reporting for acceptance gates not run; PR-head CI #44829118899 passed.
- PR #158: independent-process semantic storage acceptance. Four processes wrote 200 facts with per-operation locking; a separate process deleted 50; the test verified cross-process cursor invalidation, sidecar rebuild, 150 live facts, and delete/reinsert ordering. Full CI #44831362470 passed, and post-merge main CI #44831864535 passed.
- PR #159: D-117 restrictions across both built-in profiles. Neither profile registers host `Subprocess`; `profile-coding` also rejects `router.needle` and host-backed retrieval configuration. Tree-sitter parsing and configured semantic memory remain available. PR-head CI #44832567598 passed.
- PR #161: semantic append recovery test. It simulates interruption after the authoritative event append but before sidecar/manifest update; a fresh service instance rebuilt the sidecar and retained both facts. Full PR-head CI #44833502733 passed.
- Phase 2 SQLite coordination remains complete through PR #140 and its accepted cross-process/migration tests.
- Phase 3 p50/p95 measurements are published in [architecture-contracts.md](architecture-contracts.md). The 100k semantic-page fixture included 25k deletions and one reinsertion. Cold sidecar rebuild was 4,310.982/4,404.561 ms p50/p95. Warm 50-row pages were 19.953/25.641 ms at cursor 49,999, 18.225/25.586 ms at 89,999, and 17.867/20.190 ms at 99,899. Sampled process RSS delta was 25,427,968/26,869,760 bytes p50/p95. These are small-sample benchmark results, not production guarantees.

**Still open**
1. Phase 3: interruption during the source append itself; cross-process session-log/cache recovery; large-file and metadata-scan memory bounds; full semantic reindex/recovery stress; remaining source audit.
2. Phase 4: SQLite-backed workspace session metadata and ownership/fencing integration; task-scoped lifecycle; provider-enforced operation/path/expiry capabilities and revocation; byte-level secret-safe snapshot transfer; bounded result collection; hash-based conflict detection and governed apply; crash recovery and cleanup.
3. D-110/D-117: built-in profile paths are restricted and the host-executable CommandBackend has been moved out of the runtime router bundle into an evaluation-only script. Generic Subprocess, retrieval bundles, Crabbox source, other scripts, desktop paths, and downstream direct construction still need a repository-wide reachability audit.
4. Final acceptance: migration safety, crash recovery, full compatibility and cross-platform matrix, documentation consistency, and live Vercel acceptance.
5. Live Vercel acceptance is owner-run and requires explicit project egress authorization and credentials. The CI job named `acceptance gates NOT RUN` is informational only and is never counted as live acceptance.

**Execution order:** finish mandatory post-merge CI; complete Phase 3 recovery and memory-bound evidence; finish the host-execution source trace; implement Phase 4 in secure vertical slices; reconcile all docs; then run final acceptance. Do not enable `COMMAND_TOOL` before Phase 4 transfer, result synchronization, lifecycle, and policy gates pass.

## Historical execution snapshots

## 2026-11-21 Phase 2 execution update

Main baseline: `75574f337707460340bd2877c4a9b5a26ddaaef0`. PRs #134 and #135 are merged. PR #135 CI run #899 passed the mandatory matrix. PR #134 run #896 has one unresolved failure: Windows Node 20 `npm test`; the other three OS/runtime combinations passed. Cross-process acceptance therefore remains open.

**Next execution order:**
1. Reproduce and fix the Windows Node 20 independent-process test failure, then require a fresh full CI matrix.
2. Design and implement an explicit, idempotent migration from legacy `Budgets.statePath` JSON day counters into the SQLite shared budget store. Preserve same-day requests/tokens, define stale-day rollover, and fail closed on ambiguous/imported state. Never silently sum old and new counters.
3. Propagate an explicit task identity into `BudgetGate` and add transactional shared task-scope reservations. Do not infer task identity from session or process IDs.
4. Add LLMService integration tests for shared budget/rate-limit setup, rejection, settlement, release, retries, and DB-path/project isolation.
5. Run migration compatibility, restart, cross-process, and crash/recovery acceptance. Keep Phase 2 open until all required gates pass.

Phase 3 memory/retrieval scaling and Phase 4 task-scoped workspace sessions remain separate phases. Live Vercel acceptance remains owner-run and is not implied by CI.


Updated 2026-11-20, main `71499dea7af36995a8e7e636a88d196c8e89002f`. PRs #128-130 are merged. PR #130 integrates shared session/day hard reservations into the model-call path and its PR-head CI run #881 passed. The next Phase 2 slice is shared rate-limit windows and concurrency permits. This is the active implementation roadmap. Phase 0 is complete on the merged audit PR. Phase 1 contract artifacts are drafted and all four D-119 policy choices are approved and recorded. Numeric baselines now cover session logs, episodic memory, reservations (legacy negative control), retrieval indexing, semantic reindex, and fake-provider streaming. Shared SQLite runtime, task workspaces, live Vercel acceptance, and bounded total-memory/query paths remain open. Current project state and binding constraints are in [STATE.md](STATE.md); architecture decisions are in [decisions.md](decisions.md); detailed findings are tracked in [CODEBASE-AUDIT-CHECKLIST.md](CODEBASE-AUDIT-CHECKLIST.md).

## Historical snapshot: unified completion loop (PR #156 baseline)

Main baseline at the time of this snapshot: `2a2a60315a1e6db8b448c9c7d48a460c5bfb75b5` (PR #156 merge commit).

### Verified current state

- PR #156 is merged. Its tombstone fix preserves semantic insertion order after deletion/reinsertion. CI run #44826849470 passed all 10 jobs, including Ubuntu/Windows with Node 20.19.0 and 22.12.0, typecheck, lint, tests, docs, dependency/security, license inventory, and architecture benchmarks. Post-merge main CI run #44827470725 also passed all 10 jobs.
- Phase 2 shared SQLite coordination is implemented through PRs #128-140. The audit records PR #140 as closing the Windows Node 20 regression, legacy budget migration, explicit task identity/shared task reservations, and LLMService integration follow-ups. The historical PR #134 failure is superseded by the passing CI run #918.
- Phase 3 has bounded session-log tail reads, indexed episodic identity and keyset pages, append-only semantic events, rebuildable semantic indexes, quotas, cursor invalidation, and checkpointed paged reindex. Phase 3 remains open for concurrent/deletion-heavy scale tests, recovery and cross-process cache-invalidation evidence, and the full audit.
- CI run #44826849470 recorded current 100k episodic, 1,740-chunk indexing, and 2,000-fact semantic reindex measurements. Results and caveats are recorded in [architecture-contracts.md](architecture-contracts.md).
- CI run #44828389243's architecture job executed the 100k-event semantic page benchmark: 4,310.982 ms p50 cold index rebuild; warm 50-record pages p50/p95 19.953/25.641 ms (cursor 49,999), 18.225/25.586 ms (89,999), and 17.867/20.190 ms (99,899); sampled RSS delta p50/p95 25,427,968/26,869,760 bytes. The 100k-event fixture included 25k deletions and one reinsertion. Full CI for the latest docs commit is still required.
- Phase 4 has SQLite fenced session/capability storage, WorkspaceRuntime, and VercelWorkspaceSessionProvider. Task-scoped persistent execution and fencing are implemented; provider-validated recovery, secure byte transfer, conflict-safe result synchronization, and live acceptance remain open.
- D-110/D-117/D-118 remain binding. Host command fallback, Docker/WSL/Crabbox, automatic provider selection, and coding-profile `run_command` exposure remain prohibited.
- Vercel fake-client output capture is tested. Live SDK buffering, remote termination, and end-to-end Vercel acceptance remain unverified and require explicit egress authorization and credentials.
- The full file-by-file and cross-folder audit is incomplete. The repository currently contains 424 tracked files; the 2026-11-07 file manifest is historical, not current coverage evidence.

### Single execution order

1. Complete semantic stress evidence: exercise concurrent writers, cursor invalidation across processes, interrupted writes, sidecar rebuild, tombstone compaction, and reindex recovery against large stores. The 100k-event baseline is now recorded in architecture-contracts.md.
2. Stress semantic storage: test cursor invalidation, index rebuild, concurrent writers, deletion/reinsertion, interrupted writes, large event logs, and memory bounds.
3. Complete the D-110/D-117 security trace: follow every command execution route from CLI/profile/tool registration through provider dispatch; prove no host fallback or implicit provider selection is reachable.
4. Complete Phase 4 in bounded vertical slices: provider-validated lease-expiry recovery and restart adoption; deterministic snapshot manifests; secret/symlink/special-file-safe source enumeration; bounded byte transfer; conflict-safe governed apply; cancellation and confirmed cleanup.
5. Strengthen CI acceptance reporting: preserve mandatory-job aggregation and make informational not-run gates impossible to confuse with passed acceptance. Keep live provider gates explicitly owner-run.
6. Finish the file-by-file audit: all current source, tests, scripts, desktop code, generated files, docs, and cross-folder flows. Record evidence, severity, regression tests, and dispositions in the checklist.
7. Reconcile roadmap, state, contracts, audit register, and generated docs from verified implementation and test evidence.
8. Run full final acceptance on Ubuntu/Windows and Node 20.19/22.12, plus migration, recovery, concurrency, security, performance, and compatibility tests. Do not mark blocked owner-run gates as complete.

### Completion gates

- Phase 2: implemented; retain passing cross-process and migration evidence.
- Phase 3: open until concurrent/deletion-heavy scale tests, recovery and cross-process cursor-invalidation evidence, and audit evidence pass. The semantic-page benchmark is recorded.
- Phase 4: partially implemented; SQLite session/capability storage, WorkspaceRuntime, and the persistent Vercel session provider exist. Recovery, transfer, result synchronization, and acceptance remain open.
- Phase 5: adapter-side bounded capture implemented; live SDK and remote termination acceptance open.
- Phase 6: open until the full audit and cross-subsystem acceptance pass.
- Phase 7: blocked on approved live-provider access, credentials, and secret-safe workspace transfer.

The earlier status snapshots below are retained as historical implementation notes. When they conflict with this section, this current section is authoritative.

## Target outcome

Complete the current security and reliability audit, then migrate Harness toward shared transactional state, bounded memory, task-scoped workspace sessions, and safe output collection without breaking existing public APIs or providers.

## Binding architecture decisions

- **Shared state:** SQLite first, behind a storage interface. Support multiple local processes on one host using a supported local filesystem. Multi-machine shared state and arbitrary network filesystems are out of scope.
- **Sandbox:** capability-based, task-scoped workspace sessions added alongside the one-shot sandbox API.
- **Memory:** hybrid retention. Durable append-only history is authoritative; bounded searchable memory and vector indexes are rebuildable projections.
- **Compatibility:** preserve public APIs, existing provider contracts, persisted data, and caller-visible behavior through adapters and incremental migration.
- **Approved operating policy:** one SQLite database per project; retain durable history indefinitely by default with no automatic deletion; permit workspace resume only after lease expiry, explicit ownership acquisition, and provider-validated recovery. Otherwise create a fresh workspace.
- **Security:** D-110, D-117, and D-118 remain binding. No Docker/WSL/Crabbox, no host command fallback, no automatic sandbox provider selection, and no coding-profile `run_command` exposure before the existing acceptance requirements are met.

## Open audit work

| Priority | Findings | Required work |
|---|---|---|
| P1 | AUD-007, AUD-008 | Tail cursors reduce same-process session-log scans and episodic writes are bounded. Remove remaining full-history scans, add indexed episode identity lookup, and add paged queries with rebuild/recovery. |
| P1 | AUD-015, AUD-044 | PR #130 integrates SQLite budget reservations into `BudgetGate`/`LLMService`; migrate rate-limit windows and concurrency permits to shared transactions. |
| P1 | AUD-039 | Add task-scoped workspace sessions, capability checks, lease ownership, safe transfer, result synchronization, and verified cleanup. |

| P2 | AUD-014, AUD-025 | Queue/cache bounds are implemented. Add bounded searchable-memory quotas, paging, batched vector upserts, and resumable semantic reindexing without deleting durable history automatically. |
| P2 | AUD-016 | Collection ownership and safer replacement are implemented in PR #113. Bound prepared chunks/vectors for large files; measure vector search and decide whether/when ANN is justified. |
| P2 | AUD-023 | Vercel async log capture and bounded per-stream buffers are implemented on main. PR #126 merged SIGTERM at the cap and passed its full PR CI matrix. Live SDK internal-buffer and remote-termination acceptance remain open. Stale draft PR #123 was closed as superseded. |
| P2 | Audit remainder | Finish the incomplete file-by-file audit, verify each status against code and tests, and correct stale or unsupported register claims. |

AUD-021 is fixed in main: late sandbox creation is awaited, deletion is awaited, and cleanup failures are surfaced. Keep AUD-039 open for the separate workspace-session and transfer redesign. AUD-048 and AUD-049 are fixed in main through PR #101, merged as `67fd1666fec0ae55ea4473459c36bce78fc5b611`; the expanded head passed CI run #768. AUD-050 is fixed in PR #102 (CI run #777); AUD-051 is fixed in PR #103 (CI run #780). PRs #113-124 are merged: retrieval ownership/replacement, stricter CI gates and full dependency audit, bounded session/semantic/episodic queues, D-117 host-path shutdown, bounded tool-output serialization, batched semantic reindex, follow-up documentation synchronization in #122, and Markdown consolidation in #124. Main CI run #838 (`43868684870`) passed all 10 jobs. This does not establish live sandbox/model acceptance. The remaining file-by-file audit is still incomplete.

Withdrawn findings AUD-009, AUD-022, and AUD-027 must remain withdrawn unless new evidence changes the conclusion. Do not reopen them based on the old descriptions alone.

## Implementation phases

### Phase 0: CI and audit-branch stabilization

**Status: complete.** PR #93 merged.

- Fixed the Windows retrieval path namespace mismatch without weakening root containment checks.
- Keep Node 20.19.0 and 22.12.0 coverage on Ubuntu and Windows.
- Verify typecheck, lint, complete test suite, docs drift, full Markdown links, secret scan, dependency audit, license inventory, and `ci-pass`.
- Review Windows-specific file identity and lock behavior, including the distinction between Win32 extended-length paths returned by Node and ordinary drive paths returned by child processes.
- Added regression coverage for Windows path normalization in ripgrep JSON parsing and file enumeration. Do not treat skipped tests as passing coverage.
- Correct audit-register claims that are not supported by the actual diff or tests.

**Exit: met.** PR #93 head `5741d23058dca0dc0112810e6c35fa87a47e8d0f` passed all four OS/Node combinations, `ci-pass`, docs/component drift, secrets/dependencies, and license inventory in run #724. PR #93 merged as `8ee08673bd03b8548c44612093b447fadb03ce26`. This does not establish live sandbox/model acceptance.

### Phase 1: Architecture contracts and migration safety

**Status: contracts and policy approved; partial numeric baseline captured.**

- Added backend-neutral type contracts in `src/architecture/contracts.ts` for budget reservations, rate-limit permits, resource leases, durable history, searchable memory, reindex checkpoints, workspace sessions/capabilities, workspace transfer, and schema migrations.
- Added [architecture contract and migration specification](architecture-contracts.md), including transaction/idempotency rules, fencing tokens, failure recovery, compatibility, migration sequence, and acceptance tests.
- Preserved existing public APIs and provider contracts. This phase adds types and documentation only; it does not change runtime behavior or persisted formats.
- All four D-119 policy choices are approved and recorded in `docs/decisions.md`: single-host/multi-process deployment, one database per project, no automatic durable-history deletion, and guarded crash recovery.
- [x] Initial CI numeric baselines captured for session-log append (0/50k/100k events) and episodic duplicate/query (100k episodes) in PR #95, run #732. Results and measurement caveats are in `docs/architecture-contracts.md`.
- [x] Additional owner-run Windows x64 / Node v22.18.0 baselines recorded in PR #97. These are kept separate from the Ubuntu CI measurements and include the same session-log and episodic workloads.
- [x] Capture an independent-process budget reservation baseline with deterministic workers in PR #99. CI run #744 confirms that 2, 4, and 8 independent processes all reserve against a daily hard limit of 1, producing 1, 3, and 7 excess reservations respectively. This records the current process-local limitation; it does not satisfy the Phase 2 shared-transaction acceptance test.
- [x] Capture deterministic indexing baseline in CI run #749: 31 files, 1,740 chunks, including one 540-chunk file; p50 indexing time 306.759 ms, p50 throughput 5,672.2 chunks/s, and median observed RSS delta 24,248,320 bytes. Measurement caveats are in `architecture-contracts.md`.
- [x] Capture pre-batching semantic-reindex baseline in CI run #752: 2,000 facts, 32 embedding requests (31 x 64 and one x 16), one 2,000-vector upsert; p50 78.332 ms and median observed RSS delta 5,005,312 bytes.
- [x] Batch semantic embedding and vector upserts in PR #121 with a default batch size of 64. CI run #43757666162 measured 32 upserts for 2,000 facts; p50 193.104 ms, p50 observed RSS delta 1,941,504 bytes, and a 67,715,072-byte maximum across three samples. The full fact array remains loaded and reindex is not resumable. Measurement caveats are in `architecture-contracts.md`.
- [x] Capture output capture/truncation baseline in CI run #759 for 99k/100k/1M/8M characters per stream. PR #106 subsequently moved Vercel capture to the SDK async logs iterator with bounded per-stream buffers. Live SDK internal buffering and cancel-at-cap are still not measured; see `architecture-contracts.md`.
- Phase 1 must also pass typecheck, lint, docs checks, and the full CI matrix on its PR.

**Exit:** contract definitions and migration invariants are reviewed; four policy choices are approved; numeric baselines cover all hot paths; CI is green. Policy approval and CI are complete. Session-log, episodic-memory, independent-process budget-reservation, and indexing baselines are captured. Session-log, episodic-memory, independent-process reservation, indexing, and semantic-reindex baselines are captured. Output capture/truncation baseline is captured. Vercel async log capture and bounded output buffers are implemented; cancel-at-cap and live SDK buffer acceptance remain open. Phase 1 is not fully closed. No production behavior changes in this phase.

### Phase 2: SQLite shared-state foundation

**Status: SQLite database foundation, budget reservation store, and model-call integration merged via PRs #128-130. PR #130 PR-head CI run #881 passed. Shared rate-limit windows, concurrency permits, workspace lease metadata, task-scope reservations, and legacy `statePath` migration remain open.**

- PR #128 merged a file-backed SQLite transaction and migration coordinator using sql.js WebAssembly plus the existing cross-process file lock. It verifies checksums, rejects stale plans, rolls back callback failures, and atomically replaces the database file. Each write reloads/exports the full database, so this layer is for bounded coordination metadata, not large durable-history or vector datasets.
- PR #129 adds `SQLiteBudgetReservationStore`: atomic committed-plus-reserved checks, hard-limit consistency per subject, idempotent accepted/rejected decisions, one-time settlement of actual usage, release, and bounded reservation/idempotency cleanup.
- PR #130 merged the store wiring into `BudgetGate`/`LLMService` for configured session/day hard limits. The coding profile defaults to `.harness/state.sqlite` per project when hard limits are configured. Synchronous budget status remains process-local; use `statusAsync(sessionId)` for refreshed shared usage.
- SQLite transaction/migration foundation and versioned migration ledger are merged via PR #128.
- Add transaction helpers, bounded busy handling, constraints, and recovery.
- Shared budget reservations are integrated for session/day hard limits. Next migrate rate-limit windows/concurrency permits and workspace lease metadata. Do not mark Phase 2 complete until independent-process rate-limit/concurrency acceptance, migration compatibility, and lease ownership requirements are implemented and tested.
- Ensure one authoritative write path at each migration stage; do not perform uncoordinated dual writes.
- Keep the provider interface independent of SQLite so a server database can be added if deployment topology changes.

**Exit: met for shared coordination stores.** Independent-process budget/rate-limit/lease tests, legacy migration tests, and LLMService integration are recorded in the audit checklist. This does not implement task workspace lifecycle.

### Phase 3: Durable history and bounded memory

- Make session-log append avoid full-history scans; maintain sequence state and rebuildable offsets.
- Repair torn tails only during recovery or explicit integrity checks, not on every append.
- Add indexed episodic identity/duplicate checks and paginated queries.
- Separate durable event history from searchable memory.
- Add configurable quotas, retention, cursor paging, bounded session maps, and bounded embedding batches.
- Make vector reindexing checkpointed, resumable, and rebuildable. Semantic embedding and vector upserts are now batched at 64; paging the source fact array and adding checkpoints remain open.

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

**Status: partial.** Main consumes `Command.logs()`, retains bounded stdout/stderr buffers, and sends SIGTERM when either stream exceeds its cap. Tool-result JSON serialization is also bounded by PR #119. Live SDK buffering and remote termination remain unverified.

- Count output bytes as chunks arrive.
- Bound buffered stdout/stderr independently where required by the public contract.
- Cancel or terminate the operation at the configured cap.
- Preserve truncation metadata and deterministic timeout/cancellation behavior.
- Test UTF-8 boundaries, oversized chunks, endless streams, and provider read failures.

**Exit:** tests demonstrate bounded peak buffering, cancellation at the cap, and no unbounded drain of endless output. Live SDK internal buffering remains a separate owner-run acceptance gate.

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
