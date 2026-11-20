# Full codebase audit checklist

## 2026-11-21 latest main and verified closeout

- Current main: `5c6179d6c1bb60c71ecc603afbfb41aba23715d3`, PR #161 merged. PR-head CI #44833502733 passed all mandatory jobs; post-merge main CI #44834019205 is pending.
- PR #158 merged cross-process semantic acceptance: four writers, 200 facts, 50 deletions from another process, stale cursor rejection, 150 live facts after sidecar rebuild, and delete/reinsert ordering. PR-head CI #44831362470 and post-merge main CI #44831864535 passed.
- PR #161 merged the source-append/index-update crash-window test: a fresh service rebuilds the sidecar after an event append that did not reach the index/manifest. PR-head CI #44833502733 passed. This does not cover interruption during the source append itself.
- PR #157 published semantic page benchmark evidence. Cold index rebuild p50/p95 4,310.982/4,404.561 ms; warm 50-row page p50/p95 19.953/25.641 ms (49,999), 18.225/25.586 ms (89,999), and 17.867/20.190 ms (99,899); sampled RSS delta 25,427,968/26,869,760 bytes. Measurement caveats are in `docs/architecture-contracts.md`.
- PR #159 removes host `Subprocess` from both built-in profiles and disables host-backed retrieval/router configuration in `profile-coding`. Generic subprocess and retrieval bundles remain exported, so this is not the complete repository-wide D-110/D-117 audit.
- Phase 4 remains unimplemented. The current transfer contract has manifest/change metadata but no bounded byte transport or governed apply protocol. Workspace runtime and live Vercel acceptance remain open.
- The complete file-by-file/cross-folder audit remains incomplete; the 108-file scan and 424-file historical count below are triage evidence only.


## 2026-11-21 D-117 router executable path update

- Neither `profile-coding` nor `profile-minimal` registers the host `Subprocess` service. Both reject attempts to configure host subprocess execution; `profile-coding` also rejects `router.needle` and host-backed `retrieval.grep`, `retrieval.rank`, and `retrieval.tools`. It no longer constructs `CommandBackend`, `RetrievalGrep`, or `RetrievalRank`. Tree-sitter parsing remains available without launching a host process.
- Regression coverage: `test/router.test.ts` verifies a configured host executable is rejected; `test/profile-coding.test.ts` and `test/profile-minimal.test.ts` verify the host `Subprocess` service is absent and its configuration is rejected.
- The generic `CommandBackend`, `Subprocess`, and retrieval bundles remain exported for explicit non-profile consumers and still contain host-process execution paths. Crabbox imports `Subprocess` but remains held under D-110 and is not registered by either built-in profile. These changes close the built-in profile paths only; they do not close the repository-wide host-execution audit. Trace direct construction by downstream applications and all other subprocess consumers before declaring D-117 complete.
- The cloud-only Vercel workspace path remains unavailable until Phase 4 transfer, result synchronization, lifecycle, and policy integration pass.


## Historical audit continuation baseline (PR #156 merge)

Main at the time of this audit snapshot: `2a2a60315a1e6db8b448c9c7d48a460c5bfb75b5` (PR #156 merged).

- PR #156's semantic page ordering/tombstone fix passed all 10 CI jobs in run #44826849470, including the Ubuntu/Windows Node 20.19/22.12 matrix.
- Phase 2 follow-ups AUD-056 through AUD-059 are closed by PR #140. Run #918 passed the Ubuntu/Windows Node 20/22 matrix. Legacy budget import, explicit task identity, shared task reservations, and LLMService shared-SQLite integration tests are present.
- Phase 3 PRs #141, #142, #148, and #150 are merged. PR #150's merge-commit CI run #44822435655 passed mandatory checks. PR #151 reconciled roadmap/state and its CI run #44822718826 passed. PR #156 adds cursor-indexed semantic pages.
- CI run #44826849470 refreshed 100k episodic, 1,740-chunk indexing, and 2,000-fact semantic reindex measurements. Current numbers and caveats are recorded in `docs/architecture-contracts.md`.
- The 100k-event semantic page benchmark ran in architecture job #44828389243 with 25k deletions and one reinsertion. Warm 50-row page p50/p95 was 19.953/25.641 ms (cursor 49,999), 18.225/25.586 ms (89,999), and 17.867/20.190 ms (99,899); cold index build was 4,310.982/4,404.561 ms p50/p95. PR #158 subsequently added and passed independent-process concurrent writer/deletion, cursor invalidation, sidecar rebuild, and reinsert-order tests. Crash-during-write/restart recovery, cross-process session-log/cache recovery, and large-file memory bounds remain open.
- The main tree at the PR #156 merge contained 424 tracked files. The earlier 108-file source scan was only a triage pass. The full file-by-file and cross-folder audit remains incomplete, and folder-ledger checkboxes remain open until call paths, tests, configuration, and docs are traced.

### D-110 / D-117 host-execution trace (in progress)

Verified current paths:
- `src/cli/code.ts` hard-filters `run_command`, `search_code`, and `list_files` from the coding CLI tool offer and records that command execution is disabled under D-110.
- `src/profiles/profile-coding.ts` rejects any `sandbox` configuration, registers `LocalTools` with `enableCommand: false`, and no longer loads `Subprocess`, `RetrievalGrep`, `RetrievalRank`, or `RetrievalTools` under D-117. PR #159 also removes `Subprocess` from `profile-minimal`.
- `src/bundles/tools-local/command.ts` delegates only to `Sandbox.run()`; it does not spawn a host process. The hardened Git configuration probe also uses the sandbox seam. Built-in profiles do not expose `ctx.subprocess`.
- `src/bundles/sandbox/index.ts` requires explicit provider selection unless an explicit default is registered, and checks project consent plus host allowlisting for remote providers.
- `src/bundles/sandbox-crabbox/index.ts` still contains a provider implementation backed by host `Subprocess`, but the coding profile rejects sandbox-provider configuration and D-110 permanently holds Crabbox. Its presence in the source tree is not proof of runtime reachability.

Open trace items:
- `src/bundles/router/backends.ts` still exports an optional `CommandBackend` that spawns a configured host executable. It is no longer configurable through `profile-coding`; review any direct construction by downstream applications before closing the host-execution audit.
- Trace every other `Subprocess` consumer, CLI entry point, smoke/evidence script, and desktop entry point. The checks above are a focused path trace, not a completed repository-wide audit.
- Keep the D-110 Crabbox hold and D-117 no-host-fallback rules unchanged. Do not run local commands or probe Docker/WSL/Crabbox during this audit.

Resolved follow-up findings:
- [x] AUD-056: Windows Node 20 independent-process SQLite test failure; fixed before CI run #918.
- [x] AUD-057: lossless, idempotent migration of legacy `Budgets.statePath` JSON counters; migration tests cover exact import, one-time behavior, stale-day rollover, malformed/future state, and missing files.
- [x] AUD-058: explicit task identity and cross-process task-scope budget reservations; task identity is required and propagated through AgentLoop/LLMService.
- [x] AUD-059: LLMService shared SQLite integration coverage for reservation, settlement/release, task/session limits, concurrency, and shared rate limits.


Baseline: `main` at `0e2e38d5ea9e5b40d74422abccda4d9173c00b33` (2026-11-16). Post-merge main CI run #862 (`43876511421`) passed all 10 jobs.
Audit continuation branch: `docs/audit-findings-050-051-closeout-2026-11`.

This is a staged, evidence-based audit. Review each file, then each folder, then cross-folder flows. The follow-up fix pass updates selected findings but does not claim the full file-by-file audit is complete. Do not remove code solely because it appears old or duplicated; first verify imports, runtime registration, scripts, tests, docs, and history. Do not weaken D-110/D-117/D-118 security boundaries.

## Audit protocol

- [ ] Record the exact file and relevant lines for each finding.
- [ ] Trace imports, exports, runtime registration, CLI/profile reachability, and tests before classifying code as dead.
- [ ] Distinguish production code, test fixtures, benchmarks, historical scripts, generated files, and evidence artifacts.
- [ ] For each finding record severity (P0-P3), confidence, impact, minimal fix, regression test, and verification.
- [ ] Fix one bounded issue at a time; run focused tests before folder-level tests.
- [ ] After each folder, run typecheck/lint and the relevant test subset.
- [ ] After cross-folder work, run full test suite, docs drift, secret scan, dependency audit, license inventory, and platform CI.
- [ ] Never execute development commands on the host or use local fallback; D-117 requires an explicitly selected remote cloud sandbox. Do not probe Docker/WSL/Crabbox under D-110.
- [ ] Keep `COMMAND_TOOL` disabled until workspace transfer, result sync, lifecycle audit, and policy integration are complete.

## Checklist

### A. File-level correctness
- [ ] Stale, obsolete, unreachable, unused, or shadowed code
- [ ] Duplicate implementations, repeated constants, parallel helpers, and copy/paste drift
- [ ] Fake loops, no-op branches, placeholder success, hardcoded/mock responses in production paths
- [ ] Hardcoded paths, ports, hosts, model/provider names, limits, retry counts, timeouts, and assumptions
- [ ] Invalid defaults, missing validation, unchecked casts, unsafe parsing, and weak types
- [ ] Error handling, cancellation, timeout, cleanup, retry/idempotency, and partial-failure behavior
- [ ] Resource lifecycle: child processes, streams, timers, file handles, DB connections, sandbox leases
- [ ] Input/output bounds, pagination, memory/CPU use, large-file behavior, and denial-of-service risks
- [ ] Logging quality, secret/PII redaction, event consistency, and useful diagnostics
- [ ] API compatibility, version drift, dependency risk, licensing, and reproducible installs

### B. Security and trust boundaries
- [ ] Path traversal, symlink escape, TOCTOU, unsafe archive extraction, and workspace boundary violations
- [ ] Command injection, shell use, argv validation, environment inheritance, and host execution
- [ ] Authentication, authorization, consent scope, allowlists, policy snapshots, and fail-closed behavior
- [ ] Secret exposure through env, args, files, logs, model context, sandbox transfer, or test fixtures
- [ ] Prompt injection and untrusted model/tool/retrieval output handling
- [ ] Network egress controls, SSRF, redirect handling, TLS, and provider endpoint validation
- [ ] Audit log integrity, ordering, append-only behavior, redaction, and tamper detection

### C. Architecture and scaling
- [ ] Circular imports, hidden global state, singleton coupling, and service initialization order
- [ ] Module boundaries, dependency direction, contract duplication, and unclear ownership
- [ ] Concurrency races, locking, backpressure, queue growth, rate limits, and fairness
- [ ] Unbounded caches, histories, event logs, memory stores, and vector indexes
- [ ] Multi-session/project isolation, tenant boundaries, and state leakage
- [ ] Provider portability and capability negotiation without unsafe fallback
- [ ] Deterministic behavior, reproducibility, migration/versioning, and crash recovery
- [ ] Observability: trace/correlation IDs, metrics, structured events, and actionable failure states

### D. Tests and CI quality
- [ ] Every production module has relevant behavioral tests
- [ ] Tests assert outcomes and side effects, not only that code did not throw
- [ ] Negative, boundary, malformed-input, timeout, cancellation, race, and failure-injection coverage
- [ ] Fake/mock behavior cannot be mistaken for live acceptance
- [ ] Fixtures are isolated, deterministic, bounded, and cleaned up
- [ ] CI checks match documented commands and cover supported OS/runtime versions
- [ ] Security, dependency, license, docs generation, and generated-file drift checks
- [ ] Test flakiness, order dependence, hidden network/host dependencies, and skipped tests

### E. Documentation and contract consistency
- [ ] Source behavior matches AGENTS.md, decisions, STATE, roadmap, build plan, and component guides
- [ ] CLI/profile/config schemas match actual runtime registration and defaults
- [ ] Docs do not claim features that are missing, disabled, fake-tested only, or not live-accepted
- [ ] Generated docs are generated, current, and not hand-maintained in generated regions
- [ ] Historical/held scripts cannot be mistaken for active instructions

## Folder-by-folder ledger

- [ ] Repository root configuration and package manifests
- [ ] `.github/workflows`
- [ ] `src/bundles/agent-loop`
- [ ] `src/bundles/app-core`
- [ ] `src/bundles/egress`
- [ ] `src/bundles/embeddings`
- [ ] `src/bundles/eval-runner`
- [ ] `src/bundles/input-guard`
- [ ] `src/bundles/memory`
- [ ] `src/bundles/model-adapter`
- [ ] `src/bundles/model-store`
- [ ] `src/bundles/orchestrator`
- [ ] `src/bundles/policy-gates`
- [ ] `src/bundles/retrieval-grep`
- [ ] `src/bundles/retrieval-rank`
- [ ] `src/bundles/retrieval-tools`
- [ ] `src/bundles/retrieval-treesitter`
- [ ] `src/bundles/router`
- [ ] `src/bundles/sandbox*`
- [ ] `src/bundles/session-log`
- [ ] `src/bundles/skills`
- [ ] `src/bundles/subagent-scope`
- [ ] `src/bundles/subprocess`
- [ ] `src/bundles/tool-registry`
- [ ] `src/bundles/tools-local`
- [ ] `src/bundles/vectorstore-lancedb`
- [ ] `src/cli`
- [ ] `src/profiles`
- [ ] `src/util`
- [ ] `scripts` (including historical/held utilities)
- [ ] `app/desktop/bench`
- [ ] `test` and `test/fixtures`
- [ ] Cross-folder integration and data-flow review
- [ ] Docs and code contract reconciliation
- [ ] Full CI and final findings review

## Findings

### Confirmed findings from the first source pass

| ID | Severity | Area / evidence | Finding | Status |
|---|---|---|---|---|
| AUD-001 | P1 | `src/profiles/profile-coding.ts`, `src/bundles/tools-local/index.ts`, `src/profiles/verify-gates.ts`, `test/profile-coding.test.ts` | Before follow-up, the coding profile registered `run_command` despite D-118. The follow-up removes that registration and makes the self-test assert the tool is absent. | Fixed in main: coding profile does not register `run_command`; profile and CLI regression coverage confirms it remains unavailable |
| AUD-002 | P1 | `src/bundles/sandbox/index.ts`, `src/bundles/tools-local/command.ts` | Sandbox registration auto-selects the first provider; command requests omit provider. This violates D-117's explicit remote provider selection and creates an implicit default. | Fixed in main: provider registration no longer auto-selects the first provider; no implicit default is permitted |
| AUD-003 | P1 | `src/bundles/model-adapter/types.ts`, `src/bundles/model-adapter/index.ts`, `src/bundles/app-core/provider-connection.ts` | Provider egress metadata was optional and could be omitted by a custom provider. | Fixed in main: `LLMProvider.egress` is required; registration validates host and remote flag; completion and connection tests fail closed when metadata is absent or invalid. See provider registration checks and connection-test regression coverage |
| AUD-004 | P1 | `src/cli/wizard.ts`, `src/bundles/app-core/provider-connection.ts` | The one-off remote connection prompt defaults to yes. The wizard also treats a provider with missing egress metadata as local. This is not explicit opt-in for an external destination. | Fixed in main: remote connection-test prompt defaults to false; no probe occurs without affirmative acknowledgement |
| AUD-005 | P1 | `src/cli/code.ts`, `src/bundles/session-log/store.ts`, `src/bundles/tools-local/index.ts` | Audit logs are stored under project `.harness/sessions`, but local file tools do not protect `.harness`. An agent can read or overwrite the JSONL audit log. The JSONL store also follows symlinks for read/append/truncate. | Partially fixed in main: `.harness` is protected from model-facing file tools and final session-file symlinks are rejected. Parent-directory redirection is handled by AUD-048 in the current PR |
| AUD-006 | P1 | `src/util/filelock.ts` | `tryBreakStale` treats every `stat` or `unlink` error as a successful stale-lock break. Persistent permission errors can therefore loop forever before the configured lock timeout is checked. | Fixed in main: permission/sharing errors are treated as lock contention, timeout is bounded, and timer options are validated |
| AUD-007 | P1 | `src/bundles/session-log/store.ts` | A cache miss in `lastSeq` calls `repairTornTail`, which reads the full session file. | Partially mitigated in main: a 256-entry LRU tail cursor validates size, timestamps, inode, and device and avoids the full scan for same-process appends. A restart or external-process mutation invalidates the cursor and requires a recovery scan to rebuild the sequence/torn-tail state. Bounded range reads are implemented for requested history windows; a persistent session sequence/offset index remains a possible follow-up after measurement |
| AUD-008 | P1 | `src/bundles/memory/store.ts`, `src/bundles/memory/episodic.ts`, `src/bundles/memory/compaction.ts` | Episodic duplicate detection still scans the JSONL store, and unbounded queries still traverse the full history. | Partially fixed by PRs #141, #142, and #150: persistent episode identity uses a rebuildable sidecar index and byte-range reads; duplicate checks use indexed ID lookup; public keyset pages are available and the warm 100k page benchmark reads selected source ranges. Selective task queries still scan the metadata projection and need separate scale profiling. Continue auditing query candidate scans and rebuild memory before closing the finding |
| AUD-009 | — | `src/bundles/eval-runner/scorers.ts`, `src/bundles/orchestrator/execute.ts` | Withdrawn after call-path verification. The scorer checks execute.finished.status === completed, and the orchestrator sets that status only when every subtask completed. A 9/10 run is emitted as failed, so the suspected pass path does not occur. | False positive; do not fix |
| AUD-010 | P2 | `src/bundles/subagent-scope/index.ts`, `src/bundles/orchestrator/execute.ts` | Required-tool sequence state is created once per sub-agent scope and reused for every `agent.run`. Orchestrator retries reuse the same agent, so a tool attempt on the first try consumes the sequence for later attempts. | Fixed in main: each `SubAgent.run()` resets its required-tool sequence; regression test covers repeated runs |
| AUD-011 | P2 | `src/bundles/retrieval-grep/index.ts`, `src/bundles/retrieval-rank/index.ts` | Retrieval services resolve the configured project root from disk on each operation instead of pinning its real path at construction. Replacing a configured root symlink can redirect later searches/index reads to a different tree. | Fixed in follow-up: retrieval services pin the canonical root and reject later root identity changes |
| AUD-012 | P2 | `scripts/diagnose-crabbox.ps1`, `scripts/install-crabbox-windows.ps1`, `scripts/real-sandbox.mjs`, `scripts/smoke-crabbox.ts`, `scripts/smoke-cubesandbox.ts` | Executable diagnostics/install/smoke scripts still probe or install Docker/WSL/Crabbox, execute live Crabbox, or exercise CubeSandbox despite D-110's permanent hold and the roadmap's explicit no-Cube-workaround rule. The Crabbox diagnostic is labelled read-only but invokes WSL, Docker, and `crabbox doctor`. | Fixed in main: historical Crabbox diagnostic/install/smoke scripts fail immediately under D-110 without probing |
| AUD-013 | P1 | `scripts/ci/secret-scan.mjs` | The CI secret scanner excludes every file under `test/`, leaving test fixtures and test snapshots entirely unscanned. | Fixed in follow-up: scanner no longer excludes test files |
| AUD-014 | P2 | `src/bundles/memory/store.ts`, `src/bundles/memory/semantic.ts` | Full-history loading and unbounded episode/fact counts still lack retention or paging policy. | Partially fixed in PRs #141, #142, #148, and #156: episodic reads support streaming and stable keyset pages with indexed identity/range reads; semantic facts use quotas, revision-bound keyset pages, and paged checkpointed reindex. D-119 intentionally retains durable history indefinitely by default, so retention is not an automatic cleanup feature. Compatibility `all()` methods can still materialize full collections; continue tracing callers and prefer streaming/page APIs |
| AUD-015 | P2 | `src/bundles/model-adapter/rate-limiter.ts`, `src/bundles/app-core/budgets.ts` | Per-minute/concurrency rate limits and budget reservations are process-local. Persisted daily rate counts are locked, but budget state writes are not cross-process coordinated. Multiple Harness processes can exceed shared limits or overwrite usage updates. | Fixed in PR #140: SQLite-backed shared budget reservations, sliding rate-limit windows, and concurrency permits are integrated into model-call dispatch. Independent-process tests cover oversubscription, permit release/expiry, idempotency, and task-scoped reservations. Synchronous budget status remains process-local; use the async refresh API for shared usage. |
| AUD-016 | P2 | `src/bundles/retrieval-rank/index.ts`, `src/bundles/vectorstore-lancedb/index.ts` | Project indexing still accumulates prepared chunks/vectors in memory and LanceDB still uses exact brute-force search. | Partially mitigated in PR #113: collection ownership is enforced and replacement chunks are upserted before stale chunks are deleted. Large-file memory bounds and ANN evaluation remain open |
| AUD-017 | P2 | `src/bundles/retrieval-treesitter/index.ts` | The `maxBytes` cap checks UTF-16 code units (`source.length`), not encoded bytes, and parser size/symbol limits are not validated at construction. | Fixed in follow-up: UTF-8 byte length and parser limits are validated |
| AUD-018 | P2 | `src/bundles/router/index.ts`, `src/bundles/router/backends.ts` | Router decisions are retained forever in `rows` although stats only need aggregates. Also `shadow()` previously used the same resolver that increments `failures`, contradicting the documented claim that shadow runs do not change stats. | Fixed in follow-up: shadow stats remain isolated and decision rows are capped by maxRows |
| AUD-019 | P2 | `src/bundles/model-store/index.ts` | The NUL check uses the two-character string `\\0` rather than the NUL character, so IDs containing NUL are not rejected as intended. | Fixed in follow-up: model ids reject actual NUL bytes |
| AUD-020 | P2 | `docs/STATE.md`, `docs/ROADMAP.md`, related dependency status text | Current state still says the nested Zod audit is unresolved and cites an old failing CI run, despite the scoped override and passing audit on the audit branch. | Fixed in main: D-119 state and nested dependency/CI status are synchronized in PR #98 and later main updates |
| AUD-021 | P1 | `src/bundles/sandbox-vercel/index.ts`, `test/sandbox-vercel.test.ts` | If cancellation happens while `Sandbox.create()` is pending, a late-created sandbox must be cleaned up before cancellation returns. | Fixed on main: late creation is awaited, deletion is awaited, and cleanup failure is surfaced; success/failure regression tests are present |
| AUD-022 | P2 | `src/bundles/sandbox-vercel/index.ts`, `src/bundles/sandbox/index.ts` | Command timeout accepts any positive safe integer, but Node timers clamp delays above 2,147,483,647 ms to 1 ms. A large timeout can therefore time out almost immediately. | Fixed in main: sandbox service and Vercel adapter reject timer values above Node's maximum |
| AUD-023 | P2 | `src/bundles/sandbox-vercel/index.ts` | The Vercel adapter previously materialized complete stdout/stderr strings before applying `maxOutputBytes`. | Partially fixed in main: PR #106 uses the SDK `Command.logs()` async iterator and bounded per-stream UTF-8 capture. PR #126 merged SIGTERM at the cap after its full CI matrix passed. Live SDK buffer and remote process-tree termination acceptance remain open. Stale draft PR #123 was closed as superseded. Live SDK buffer/remote termination acceptance remain open |
| AUD-024 | P2 | `src/bundles/subagent-scope/index.ts` | Closed scopes are marked and revoked but never removed from the `scopes` map. A long-lived context that creates many sub-agents retains every scope, actor, and tool set indefinitely. | Fixed in follow-up: closed scope objects are removed; bounded tombstones preserve immediate id reuse protection |
| AUD-025 | P2 | `src/bundles/memory/semantic.ts`, `src/bundles/memory/types.ts` | Semantic facts are loaded as one JSON array and re-embedded as one complete batch during reindex. There is no fact-count, storage-size, or paged reindex bound. | Fixed for the unbounded source-array/reindex path by PRs #142, #148, and #150: semantic facts are persisted as append-only events with rebuildable indexes; active-fact quotas and revision-bound keyset pages bound source reads; reindex pages facts and persists resumable checkpoints while batching embeddings/upserts at 64. The ID/text projection is still loaded in memory, so constant-memory identity indexing is not claimed. The 100k-event page baseline is recorded in architecture-contracts.md. |
| AUD-026 | P2 | `scripts/license-inventory.ts`, `.github/workflows/ci.yml` | The inventory script writes `THIRD_PARTY_LICENSES.generated.md`, but CI's diff check watches the historical `THIRD_PARTY_LICENSES.md`. The generated output could drift without failing CI. | Fixed and CI-verified on audit branch: CI checks the generated inventory and the committed Zod 4.6.7 row |
| AUD-027 | P2 | `src/bundles/subprocess/index.ts`, `src/bundles/policy-gates/index.ts`, `src/bundles/sandbox-vercel/index.ts` | Several timeout configs accepted safe integers above Node's timer maximum (2,147,483,647 ms). | Fixed in main: Subprocess validates default/per-call timeout and kill grace; PolicyGates bounds approval timeout; Vercel bounds command timeout. Regression tests cover timer limits.
| AUD-028 | P1 | `app/desktop/bench/measure-electron.mjs`, `app/desktop/bench/measure-tauri.mjs` | Both benchmark scripts recursively delete their checked-in `hello-electron` / `hello-tauri` directories before scaffolding. Running the documented benchmark commands destroys tracked source/config files in the repository. The benchmark README does not warn about this destructive behavior. | Fixed in main: Electron and Tauri benchmarks scaffold only under isolated temporary directories |
| AUD-029 | P1 | `scripts/real-sandbox.mjs`, `scripts/smoke-crabbox.ts`, `scripts/install-crabbox-windows.ps1`, related S0 artifacts | Executable scripts can install, probe, or run Crabbox despite D-110's permanent hold. `real-sandbox.mjs` actively sets the opt-in environment flag itself, so the hold can be bypassed by a single package script invocation. | Fixed in main: Crabbox live acceptance script is a hard D-110 blocker and no longer sets an opt-in probe flag |
| AUD-030 | P2 | `scripts/smoke-cubesandbox.ts`, `src/profiles/profile-coding.ts` | CubeSandbox remains in source as a historical provider, although it is not the selected acceptance path. | Fixed in main: the smoke script fails immediately under D-118, and profile-coding rejects sandbox provider configuration with an explicit CubeSandbox exclusion. No provider is registered by the coding profile.
| AUD-031 | P1 | `src/bundles/sandbox/index.ts`, `src/profiles/profile-coding.ts` | `Sandbox.register()` silently makes the first registered provider the default when `opts.default` is omitted. The coding profile registers Crabbox before CubeSandbox and only sets a default if config names one, so provider choice can happen implicitly and select the held local Crabbox provider. This conflicts with D-110/D-117's no-probe and explicit remote-provider rules. | Fixed in main: sandbox service has no implicit first-provider default; explicit provider selection is required |
| AUD-032 | P1 | `src/cli/wizard.ts` | The remote provider connection-test prompt defaults to `true`. Pressing Enter sends a live probe and API key to the remote host without an affirmative choice, contrary to the explicit-consent rule. The later persistent project-consent prompt correctly defaults to false, but that does not undo the earlier probe. | Fixed in main: remote connection test requires explicit acknowledgement and defaults to false |

| AUD-033 | P1 | `src/bundles/tools-local/paths.ts`, `src/bundles/egress/store.ts`, `src/bundles/app-core/budgets.ts`, `.harness/**` | The model-facing file tools can edit `.harness/consent.json` and persisted budget/rate-limit state because `.harness` is not protected. A forged `consented: true` record is accepted by `FileConsentStore`, so an agent can change the file-backed user-consent decision itself. The same path exposes session logs and other control-plane state. | Fixed in main: `.harness` paths are blocked by model-facing file tools; consent and budget state use protected file handling |
| AUD-034 | P2 | `src/util/filelock.ts` | `tryBreakStale()` catches every `stat`/`unlink` error and treats it as if the lock vanished. On permission or I/O errors, the outer loop immediately retries without checking `timeoutMs`, so a lock attempt can spin forever instead of failing closed with a useful error. `LockOptions` also accepts invalid/negative/oversized timer values without validation. | Fixed in main: file-lock permission handling and timeout/config validation are fail-closed |
| AUD-035 | P1 | `src/bundles/session-log/store.ts`, `test/session-log.test.ts` | Persistent session logs previously followed symlinks at the final session filename. | Fixed in main: final session-file symlinks are rejected and opened-file identity is checked; parent path handling is AUD-048 |

| AUD-036 | P1 | `src/bundles/memory/hot.ts`, `src/bundles/memory/semantic.ts`, `src/bundles/memory/store.ts`, `src/bundles/app-core/credentials.ts` | Several persistent stores read configured paths with `readFile`/`readFileSync` without rejecting symlinks or verifying file identity. A project-controlled symlink can load external JSON/JSONL into memory or model context. Credential data reads are also not protected like the encryption-key file. | Fixed in follow-up: memory and credential state reads use no-follow regular-file helpers and validate parent directories; helper regression tests added |
| AUD-037 | P1 | `src/bundles/app-core/budgets.ts`, `src/bundles/model-adapter/rate-limiter.ts` | Persisted budget and daily rate-limit state are read through symlinks without file identity validation. A pre-planted symlink to a valid low-count state file can reset/undercount persisted usage and bypass spending/request limits. Atomic rename on write does not protect the initial read. | Fixed in follow-up: budget and daily rate state reads reject symlinks; state writes validate parent directories |
| AUD-038 | P1 | `src/bundles/egress/store.ts`, `src/bundles/app-core/credentials.ts` | File-level symlink checks do not validate every parent directory component. A symlinked `.harness` or parent state directory can redirect consent/credential reads and writes outside the intended project state location. | Fixed in follow-up: consent and credential paths reject symlinked parent directories |

| AUD-039 | P1 | `src/bundles/sandbox/types.ts`, `src/bundles/sandbox-vercel/index.ts`, `src/bundles/tools-local/index.ts`, `src/bundles/tools-local/command.ts` | The sandbox contract is one-shot `run(command)` and the Vercel provider creates and deletes a fresh sandbox for every command. A multi-step coding task needs one shared workspace across reads/builds/tests and repeated commands; the current contract cannot preserve that state. `hardenedGit` also makes a separate sandbox call from the command itself. Workspace transfer/result sync cannot be added cleanly without a task-scoped lease/session API or repeated snapshot round-trips. | Confirmed architecture blocker; redesign before workspace transfer

| AUD-040 | P1 | `src/bundles/retrieval-grep/index.ts`, `src/profiles/profile-coding.ts`, `src/bundles/subprocess/index.ts` | `search_code` calls host `Subprocess.run('rg', ...)` through the profile's `Subprocess` service. D-117 explicitly includes project search/inspection in the remote-only command boundary and forbids host subprocess fallback. Filtering only `COMMAND_TOOL` in the CLI does not prevent this host process path. | Fixed in follow-up: coding profile disables host subprocess-backed retrieval tools until remote search is available |

| AUD-041 | P2 | `test/retrieval-tools.test.ts`, `test/retrieval-grep.test.ts`, `.github/workflows/ci.yml` | Retrieval tests are guarded by `describe.skipIf(!hasRg)`. CI does not install or assert ripgrep, so a runner without `rg` can skip the retrieval feature's tests and still pass the suite. | Fixed in follow-up: CI installs ripgrep on both operating systems so retrieval suites execute |
| AUD-042 | P2 | `scripts/docs/check-docs.mjs` | The docs checker validates a small fixed list plus `docs/components/**`, not the full Markdown tree. Broken links or contradictory instructions in root docs, phase docs, and evidence guides can pass CI. | Fixed in follow-up: docs checker validates relative links across the repository Markdown tree |
| AUD-043 | P2 | `scripts/ci/secret-scan.mjs` | The secret scanner skips every file under `test/`, not just known fake-secret fixtures. A real credential accidentally committed in a test or fixture is invisible to CI. | Fixed in follow-up: scanner checks test files instead of excluding the directory |
| AUD-044 | P2 | `src/bundles/model-adapter/rate-limiter.ts`, `src/bundles/app-core/budgets.ts` | Per-minute request timestamps, in-flight concurrency, and budget reservations are process-local. Multiple Harness processes using the same provider/state path can exceed per-minute or session/day limits even though daily rate counters use a file lock. | Fixed in PR #140: SQLite-backed sliding-window rate limits, concurrency permits, and budget reservations now coordinate independent processes. The supported scope is multi-process on one supported local filesystem, not multi-machine/network-filesystem sharing. |
| AUD-045 | P2 | `package.json`, `.github/workflows/ci.yml` | `package.json` declares Node `^20.19.0 || >=22.12.0`, but CI tests only Node 22. Regressions specific to the supported Node 20 line can merge unnoticed. | Fixed in follow-up: CI matrix covers Node 20.19.0 and 22.12.0 on Ubuntu and Windows |
| AUD-046 | P2 | `src/bundles/router/backends.ts` | `CommandBackend` accepts any positive safe-integer `timeoutMs` and passes it to `setTimeout`. Values above 2,147,483,647 ms are clamped by Node to 1 ms, causing premature backend termination. | Fixed in main: command backend timeout is validated against the Node timer maximum; boundary regression test added |
| AUD-047 | P2 | `src/bundles/router/index.ts` | `Router.shadow()` reuses `resolve()`, which increments `failures` when Needle throws or returns an invalid choice. This mutates `stats()` even though the shadow API promises no stats changes. | Fixed in main: shadow resolution does not mutate failure counters; regression test added |
| AUD-048 | P1 | `src/bundles/session-log/store.ts`, `test/session-log.test.ts` | The store rejected symlinks at the final session filename but did not validate parent directories. A symlinked configured session directory or ancestor could redirect audit-log reads, appends, locks, and listing outside the configured project state path. | Fixed in PR #101: parent components are checked before/after directory creation and file open; regression test covers append/read/list. Current head passed CI run #768 |
| AUD-049 | P1 | `src/bundles/memory/compaction.ts`, `test/memory-compaction.test.ts` | The compaction ledger followed symlinked final/parent paths and replaced the ledger through a predictable `${process.pid}.tmp` path opened with default overwrite semantics. A planted temp symlink could redirect the ledger write to an arbitrary file. | Fixed in PR #101: no-follow ledger read, parent validation, unique `randomUUID()` temp path opened with `wx` and mode `0600`, regression tests for parent/ledger/temp symlinks. Current head passed CI run #768 |
| AUD-050 | P1 | `src/bundles/skills/index.ts`, `test/skills.test.ts` | Skill discovery followed child directory symlinks outside the configured root and read external `SKILL.md` content. `readSkill()` and `instructions()` also followed a symlinked `SKILL.md`; resource reads had a realpath containment check but opened the resolved path without no-follow/file-identity validation. | Fixed in PR #102, merged as `082e83629ea20ead62e001cf27357bd4952fd6a5`; CI run #777 passed all Linux/Windows Node 20/22 jobs and `ci-pass`. Regression tests cover external directory and instruction-file symlinks |
| AUD-051 | P1 | `src/bundles/memory/semantic.ts`, `test/memory-semantic.test.ts` | Concurrent same-ID semantic fact updates could complete embeddings out of order, allowing an older embedding to overwrite the newer fact's vector. Delayed removal could also delete a replacement vector. | Fixed in PR #103, merged as `0bb27968955b218c5ea188f35b3d0939623a32cb`; serialize index mutations, verify fact version after embedding, recheck removals, and serialize queries with rebuilds. Deterministic race regression test; CI run #780 passed all matrix jobs and `ci-pass` |
| AUD-052 | P1 | `scripts/smoke-coding.ts`, `scripts/smoke-phase2.ts`, `scripts/events/run-logged.mjs` | Smoke paths could execute generated code, auto-approve writes, run host subprocesses, or perform host-backed retrieval despite D-117. | Fixed in PR #118: all three paths fail closed, and `AGENTS.md` no longer instructs host command execution. CI run #43755514677 passed all matrix jobs and `ci-pass` |
| AUD-053 | P2 | `src/bundles/tool-registry/index.ts`, `test/tool-registry.test.ts` | Tool output was fully materialized by `JSON.stringify` before the character cap was applied. | Fixed in PR #119: incremental plain-object/array serialization stops at the character cap and also bounds traversal to 10,000 nodes and depth 32. Unsupported objects use a bounded placeholder. Regression tests verify early stop and no custom stringifier execution; CI run #43756237948 passed |
| AUD-054 | P2 | `src/bundles/session-log/index.ts`, `src/bundles/memory/semantic.ts`, `src/bundles/memory/store.ts` | Per-session and serialized memory write queues could retain unbounded pending work; session caches and queue entries also accumulated. | Fixed in PRs #115-117: session appends, semantic operations, and persistent episodic writes have configurable bounds; completed session queue entries are released and the sequence cache is capped at 256. CI runs #43754058474, #43754660989, and #43755063045 passed |


### Verification corrections

- AUD-009 was withdrawn after tracing execute.finished: the orchestrator emits status completed only when counts.completed equals the total subtask count. The scorer therefore does not accept a partial run. This is why suspected local bugs must be traced across module boundaries.
- AUD-011 is P2, not P1: root canonicalization is repeated per operation, so the concern requires an external replacement of the configured root path or symlink. Pin the canonical root at construction and test root-symlink replacement before treating this as an exploit.
- AUD-010 is P2 reliability: required-tool sequence state belongs to the sub-agent scope, not an individual run, and orchestrator retries reuse the same sub-agent.
- AUD-012 is P2 scope-control: these are executable historical/diagnostic scripts, not a production command path. They still conflict with the current permanent-hold decision and need a hard guard or archival relocation.

### Folder progress (14 November 2026)

- [~] Core runtime bundles: first-pass reads across agent-loop, app-core, egress, embeddings, eval-runner, memory, model-adapter, model-store, orchestrator, policy-gates, retrieval, router, sandbox, session-log, subagent-scope, subprocess, tool-registry, and tools-local. This is not a completion mark; imports, tests, and remaining files still need tracing.
- [~] Profiles and CLI: profile-coding, profile-minimal, code task entry, wizard, and provider connection path read. Remaining CLI/config files still pending.
- [~] Scripts: docs generation/check, secret scan, historical apply-docs scripts, Crabbox/Cube/Vercel smoke and diagnostic scripts sampled. Full script inventory still pending.
- [ ] Root configuration, complete CI workflow, every source file, every test, all fixtures, desktop benchmark, and cross-folder integration are not yet complete.
- [x] Production fixes have been made on the audit branch for provider egress, consent defaults, `.harness` protection, session-log symlinks, file-lock errors, sandbox default selection, held scripts, benchmark isolation, and CLI host-tool filtering. Focused regression tests were added; full CI passed on commit `30401b9267fbf5e2578b752f61ba802a2e1dba1c`.
- [ ] Full file-by-file audit is incomplete. Persistent-store symlink handling, session-log O(N²) append cost, late Vercel cleanup, direct profile tool exposure, secret-scan exclusions, and sandbox workspace lifecycle remain open.
- [x] Main baseline: `81d7bf837254b8526b60aa240d6a31923647a890`. Audit branch CI run `43516548037` completed successfully on `30401b9267fbf5e2578b752f61ba802a2e1dba1c` across Ubuntu and Windows, including docs, license, secret, and dependency checks. This does not change main until PR #92 is merged.

These are first-pass findings, not the final register. Some fixes have been implemented and CI-verified on this audit branch; none are in main until PR #92 is reviewed and merged. Continue reading the remaining files and verify each finding against tests/callers before changing behavior. Do not mark a folder complete until every file in its scope has been read and its imports/callers/tests have been traced.


## Follow-up fix pass (2026-11-14)

Contained fixes in this pass include: direct-profile run_command removal; host-backed retrieval tool disablement under D-117; pinned retrieval roots; UTF-8 parser byte limits; NUL validation; bounded router and sub-agent retention; no-follow persistent state helpers for memory, credentials, budgets, rate limits, and egress consent; test-inclusive secret scanning; full-tree Markdown link checks; explicit ripgrep CI setup; and Node 20/22 CI coverage.

The following findings remain open or partially mitigated: AUD-007/AUD-008 (cross-process/history scans and episodic indexing), AUD-014/AUD-025 (retention, paging, and resumable semantic reindex), AUD-015/AUD-044 (cross-process transactional reservations), AUD-016 (large-file indexing memory and ANN evaluation), AUD-023 (cancel-at-cap and live SDK acceptance), and AUD-039 (task-scoped workspace lifecycle/transfer/result sync). PRs #113-121 address collection ownership, queue bounds, host execution paths, bounded tool serialization, and batched semantic reindex; PR #120 synchronizes the audit documents. D-110/D-117/D-118 remain in force. No live sandbox acceptance was run.

CI for this follow-up must be treated as unverified until the new pull request's complete matrix and ci-pass job succeed.


## D-119 architecture decisions and current PR verification (2026-11-14)
D-119 selects SQLite for shared transactional state (initially multi-process, single-machine/local-filesystem only), capability-based task-scoped workspace sessions alongside the one-shot sandbox API, hybrid durable-history plus bounded searchable-memory retention, and backward-compatible internal migration. Approved policy is one database per project, no automatic durable-history deletion, and workspace resume only after lease expiry, explicit ownership acquisition, and provider-validated recovery. See `docs/decisions.md` and `docs/ROADMAP.md` for the full migration plan.

CI note: PR #95 is merged. Its initial run #731 had a Windows Node 20.19.0 test failure; the final head passed run #732 across Ubuntu and Windows on Node 20.19.0 and 22.12.0, including benchmark and `ci-pass`.


## Phase 0 / Phase 1 closeout — 2026-11-14

- [x] Phase 0 CI stabilization merged in PR #93. Run #724 passed all four OS/Node combinations, `ci-pass`, docs/component drift, secret scan, dependency audit, and license inventory.
- [x] Windows retrieval root normalization regression fixed and covered by a Windows-only test.
- [x] Phase 1 backend-neutral contracts drafted in `src/architecture/contracts.ts`.
- [x] Transaction, idempotency, lease fencing, memory projection, workspace capability, migration, rollback, and failure-recovery rules documented in `docs/architecture-contracts.md`.
- [x] State, roadmap, architecture, and D-119 decision docs cross-linked and reconciled.
- [x] Phase 1 owner approvals: single-host/multi-process deployment on supported local filesystems; one SQLite database per project; no automatic durable-history deletion; workspace resume only after lease expiry, explicit ownership, and provider-validated recovery. Recorded as binding D-119 policy in `docs/decisions.md`.
- [x] Capture initial session-log and episodic-memory numeric baselines in PR #95; CI run #732 passed. Results and caveats are recorded in `docs/architecture-contracts.md`.
- [ ] Capture independent-process reservation, indexing, semantic-reindex, and streaming-output baselines before changing those hot paths.
- [x] Full CI matrix and `ci-pass` on PR #94, run #726: Ubuntu and Windows on Node 20.19.0 and 22.12.0; typecheck, lint, tests, docs/component drift, secret/dependency checks, and license inventory passed.

Phase 0 is complete. Phase 1 contracts, owner policy approvals, CI, and initial session-log/episodic baselines are complete. Reservation, indexing, semantic-reindex, and streaming-output baselines remain before Phase 1 closure. The full file-by-file audit is not complete.


## Current audit continuation — 2026-11-14

- Main baseline is `41ca36359b6502c986fd41924cbc6b1d643b1077`; PR #100 is merged. Post-merge CI run #761 passed `ci-pass`, typecheck, lint, full tests, docs/component drift, secrets/dependencies, license inventory, architecture benchmarks, and Ubuntu/Windows on Node 20.19.0/22.12.0.
- Repository inventory at this baseline: 352 tracked files; 214 files under `src/`, `test/`, and `scripts/`. The full file-by-file and cross-folder audit remains incomplete.
- AUD-007 current behavior: same-process appends normally reuse a validated bounded tail cursor; a restart or external-process write invalidates it and triggers full tail repair/scan. Cross-process transaction/index work remains open.
- AUD-008 current behavior: the persistent write queue is bounded, but duplicate detection still scans history and queries still traverse all records unless a limit is used. Indexed identity lookup and paging remain open.
- AUD-021 and AUD-035 are fixed in current main and covered by source-level regression tests; their previous open statuses were stale.
- Added AUD-048 after finding that the session-log store checked the final file but not symlinked parent directories. The fix and regression test are in PR #101; the expanded current head passed all jobs in CI run #768.
- Added AUD-049 after finding that compaction ledger persistence followed symlinks and used a predictable overwriteable temporary path. The fix and three regression tests are in PR #101; the expanded current head passed all jobs in CI run #768.
- Reviewed the Vercel adapter and profile call path: late-create cleanup is awaited and surfaced; the command tool rejects `released: false`; workspace transfer/result sync and real SDK streaming remain unimplemented. No live Vercel call was made.


## Skills security audit — 2026-11-14

- Confirmed AUD-050: configured skill roots were canonicalized, but child symlink directories and symlinked `SKILL.md` files could escape the configured root. Fixed in PR #102, merged as `082e83629ea20ead62e001cf27357bd4952fd6a5`; CI run #777 passed all Linux/Windows Node 20/22 jobs and `ci-pass`.
- Confirmed AUD-051: concurrent same-ID semantic updates could write vectors out of order, and delayed removal could delete a replacement vector. Fixed in PR #103, merged as `0bb27968955b218c5ea188f35b3d0939623a32cb`; CI run #780 passed all Linux/Windows Node 20/22 jobs and `ci-pass`.
- The complete file-by-file and cross-folder audit remains incomplete.

## Current audit continuation — 2026-11-16

- Main baseline: `cf79353a0aa66c96354724980288861467257bd9`. PR #113 (retrieval collection ownership and safer replacement), #114 (strict aggregate CI and full dependency audit), #115-117 (bounded session, semantic, and episodic queues), #118 (D-117 host-path shutdown), #119 (bounded tool-output serialization), #120 (audit documentation reconciliation), and #121 (batched semantic reindex) are merged.
- PR-head CI passed for #113 (`43632476855`), #114 (`43632866040`), #115 (`43754058474`), #116 (`43754660989`), #117 (`43755063045`), #118 (`43755514677`), and #119 (`43756237948`). PR #121 is merged; its full CI run `43757877742` and post-merge main run `43757888191` are still running. The semantic reindex architecture benchmark passed in `43757666162`.
- The full file-by-file and cross-folder audit remains incomplete. D-110/D-117/D-118/D-119 remain binding.
