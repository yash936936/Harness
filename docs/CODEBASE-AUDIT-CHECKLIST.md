# Full codebase audit checklist

Baseline: `main` at `81d7bf837254b8526b60aa240d6a31923647a890` (2026-11-14).
Audit branch: `audit/full-codebase-review-2026-11`.

This is a staged, evidence-based audit. Review each file, then each folder, then cross-folder flows. Do not remove code solely because it appears old or duplicated; first verify imports, runtime registration, scripts, tests, docs, and history. Do not weaken D-110/D-117/D-118 security boundaries.

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
| AUD-001 | P1 | `src/profiles/profile-coding.ts`, `src/bundles/tools-local/index.ts`, `src/profiles/verify-gates.ts`, `test/profile-coding.test.ts` | The coding profile registers `run_command` and requires it in the self-test, although D-118 says it must remain filtered until workspace transfer, safe sync, lifecycle audit, and policy integration pass. The CLI filters it, but callers of `bootProfileCoding` do not. | Confirmed; fix pending |
| AUD-002 | P1 | `src/bundles/sandbox/index.ts`, `src/bundles/tools-local/command.ts` | Sandbox registration auto-selects the first provider; command requests omit provider. This violates D-117's explicit remote provider selection and creates an implicit default. | Confirmed; fix pending |
| AUD-003 | P1 | `src/bundles/model-adapter/types.ts`, `src/bundles/model-adapter/index.ts`, `src/bundles/app-core/provider-connection.ts` | Provider egress metadata is optional. The model adapter and connection test only enforce remote consent/allowlisting when `egress.remote` is present, so a custom network provider can omit it and bypass the boundary. | Confirmed; fix pending |
| AUD-004 | P1 | `src/cli/wizard.ts`, `src/bundles/app-core/provider-connection.ts` | The one-off remote connection prompt defaults to yes. The wizard also treats a provider with missing egress metadata as local. This is not explicit opt-in for an external destination. | Confirmed; fix pending |
| AUD-005 | P1 | `src/cli/code.ts`, `src/bundles/session-log/store.ts`, `src/bundles/tools-local/index.ts` | Audit logs are stored under project `.harness/sessions`, but local file tools do not protect `.harness`. An agent can read or overwrite the JSONL audit log. The JSONL store also follows symlinks for read/append/truncate. | Confirmed; fix pending |
| AUD-006 | P1 | `src/util/filelock.ts` | `tryBreakStale` treats every `stat` or `unlink` error as a successful stale-lock break. Persistent permission errors can therefore loop forever before the configured lock timeout is checked. | Confirmed; fix pending |
| AUD-007 | P1 | `src/bundles/session-log/store.ts` | Every append calls `lastSeq`, which calls `repairTornTail`; that reads and parses the entire session file. Appending N events therefore performs O(N²) cumulative file scanning and repeatedly allocates the full history. | Confirmed; fix pending |
| AUD-008 | P1 | `src/bundles/memory/store.ts`, `src/bundles/memory/episodic.ts`, `src/bundles/memory/compaction.ts` | Episodic queries and duplicate checks load/scan the entire JSONL store. Each append also reads all IDs/history. Memory cost and cumulative work grow with the full history. | Confirmed; fix pending |
| AUD-009 | — | `src/bundles/eval-runner/scorers.ts`, `src/bundles/orchestrator/execute.ts` | Withdrawn after call-path verification. The scorer checks execute.finished.status === completed, and the orchestrator sets that status only when every subtask completed. A 9/10 run is emitted as failed, so the suspected pass path does not occur. | False positive; do not fix |
| AUD-010 | P2 | `src/bundles/subagent-scope/index.ts`, `src/bundles/orchestrator/execute.ts` | Required-tool sequence state is created once per sub-agent scope and reused for every `agent.run`. Orchestrator retries reuse the same agent, so a tool attempt on the first try consumes the sequence for later attempts. | Confirmed by state ownership; regression test pending |
| AUD-011 | P2 | `src/bundles/retrieval-grep/index.ts`, `src/bundles/retrieval-rank/index.ts` | Retrieval services resolve the configured project root from disk on each operation instead of pinning its real path at construction. Replacing a configured root symlink can redirect later searches/index reads to a different tree. | Confirmed; fix pending |
| AUD-012 | P2 | `scripts/diagnose-crabbox.ps1`, `scripts/install-crabbox-windows.ps1`, `scripts/real-sandbox.mjs`, `scripts/smoke-crabbox.ts`, `scripts/smoke-cubesandbox.ts` | Executable diagnostics/install/smoke scripts still probe or install Docker/WSL/Crabbox, execute live Crabbox, or exercise CubeSandbox despite D-110's permanent hold and the roadmap's explicit no-Cube-workaround rule. The Crabbox diagnostic is labelled read-only but invokes WSL, Docker, and `crabbox doctor`. | Confirmed; disable/remove pending |
| AUD-013 | P1 | `scripts/ci/secret-scan.mjs` | The CI secret scanner excludes every file under `test/`, leaving test fixtures and test snapshots entirely unscanned. | Confirmed; fix pending |
| AUD-014 | P2 | `src/bundles/memory/store.ts`, `src/bundles/memory/semantic.ts` | Full-history loading, unbounded episode/fact counts, and in-memory session maps have no retention or paging policy. This is a future memory-growth limit even after the immediate scan cost is fixed. | Confirmed; design pending |
| AUD-015 | P2 | `src/bundles/model-adapter/rate-limiter.ts`, `src/bundles/app-core/budgets.ts` | Per-minute/concurrency rate limits and budget reservations are process-local. Persisted daily rate counts are locked, but budget state writes are not cross-process coordinated. Multiple Harness processes can exceed shared limits or overwrite usage updates. | Confirmed/documented limitation; design pending |
| AUD-016 | P2 | `src/bundles/retrieval-rank/index.ts`, `src/bundles/vectorstore-lancedb/index.ts` | Project indexing accumulates all prepared chunks and vectors in memory before/while batching; a single large file can exceed the nominal group size. LanceDB currently performs exact brute-force vector search with no ANN index. | Confirmed scaling limits; design pending |
| AUD-017 | P2 | `src/bundles/retrieval-treesitter/index.ts` | The `maxBytes` cap checks UTF-16 code units (`source.length`), not encoded bytes, and parser size/symbol limits are not validated at construction. | Confirmed; fix pending |
| AUD-018 | P2 | `src/bundles/router/index.ts`, `src/bundles/router/backends.ts` | Router decisions are retained forever in `rows` although stats only need aggregates. Also `shadow()` uses the same resolver that increments `failures`, contradicting the documented claim that shadow runs do not change stats. | Confirmed; fix pending |
| AUD-019 | P2 | `src/bundles/model-store/index.ts` | The NUL check uses the two-character string `\\0` rather than the NUL character, so IDs containing NUL are not rejected as intended. | Confirmed; fix pending |
| AUD-020 | P2 | `docs/STATE.md`, `docs/ROADMAP.md`, related dependency status text | Current state still says the nested Zod audit is unresolved and cites an old failing CI run, despite the merged scoped override and passing audit. | Confirmed; docs update pending |
| AUD-021 | P1 | `src/bundles/sandbox-vercel/index.ts` | If cancellation happens while `Sandbox.create()` is pending, a late-created sandbox is deleted in a detached promise. Delete failure is swallowed, and the cancelled call returns before cleanup is confirmed. A cloud lease can leak without an audit result. | Confirmed; failure-path test/fix pending |
| AUD-022 | P2 | `src/bundles/sandbox-vercel/index.ts`, `src/bundles/sandbox/index.ts` | Command timeout accepts any positive safe integer, but Node timers clamp delays above 2,147,483,647 ms to 1 ms. A large timeout can therefore time out almost immediately. | Confirmed; boundary test/fix pending |
| AUD-023 | P2 | `src/bundles/sandbox-vercel/index.ts` | `maxOutputBytes` is enforced only after `stdout()` and `stderr()` have returned complete strings. The returned output is bounded, but peak memory use is not. | Confirmed limitation; streaming or SDK-side cap needed |
| AUD-024 | P2 | `src/bundles/subagent-scope/index.ts` | Closed scopes are marked and revoked but never removed from the `scopes` map. A long-lived context that creates many sub-agents retains every scope, actor, and tool set indefinitely. | Confirmed; lifecycle/retention design pending |
| AUD-025 | P2 | `src/bundles/memory/semantic.ts`, `src/bundles/memory/types.ts` | Semantic facts are loaded as one JSON array and re-embedded as one complete batch during reindex. There is no fact-count, storage-size, or paged reindex bound. | Confirmed scaling limit; batching/retention design pending |
| AUD-026 | P2 | `scripts/license-inventory.ts`, `.github/workflows/ci.yml` | The inventory script writes `THIRD_PARTY_LICENSES.generated.md`, but CI's diff check watches `THIRD_PARTY_LICENSES.md`. The generated output can drift without failing CI, so the job does not verify the artifact it just generated. | Confirmed; align output/check path |
| AUD-027 | P2 | `src/bundles/subprocess/index.ts`, `src/bundles/policy-gates/index.ts`, `src/bundles/sandbox-vercel/index.ts` | Several timeout configs accept safe integers above Node's timer maximum (2,147,483,647 ms). Node clamps oversized timer delays to 1 ms, so extreme but valid values can cause immediate timeouts or premature kills. | Confirmed; cap timer-backed config values |
| AUD-028 | P1 | `app/desktop/bench/measure-electron.mjs`, `app/desktop/bench/measure-tauri.mjs` | Both benchmark scripts recursively delete their checked-in `hello-electron` / `hello-tauri` directories before scaffolding. Running the documented benchmark commands destroys tracked source/config files in the repository. The benchmark README does not warn about this destructive behavior. | Confirmed; use isolated temp workspace and preserve templates |
| AUD-029 | P1 | `scripts/real-sandbox.mjs`, `scripts/smoke-crabbox.ts`, `scripts/install-crabbox-windows.ps1`, related S0 artifacts | Executable scripts can install, probe, or run Crabbox despite D-110's permanent hold. `real-sandbox.mjs` actively sets the opt-in environment flag itself, so the hold can be bypassed by a single package script invocation. | Confirmed; hard-disable or archive held scripts |
| AUD-030 | P2 | `scripts/smoke-cubesandbox.ts`, `src/profiles/profile-coding.ts` | CubeSandbox remains available as a provider/configuration path even though the current roadmap explicitly excludes it as a workaround and selects Vercel as the first cloud provider. This creates a stale route that can diverge from the current acceptance path. | Confirmed; mark unavailable until an explicit decision |
| AUD-031 | P1 | `src/bundles/sandbox/index.ts`, `src/profiles/profile-coding.ts` | `Sandbox.register()` silently makes the first registered provider the default when `opts.default` is omitted. The coding profile registers Crabbox before CubeSandbox and only sets a default if config names one, so provider choice can happen implicitly and select the held local Crabbox provider. This conflicts with D-110/D-117's no-probe and explicit remote-provider rules. | Confirmed; require explicit default and reject held providers |
| AUD-032 | P1 | `src/cli/wizard.ts` | The remote provider connection-test prompt defaults to `true`. Pressing Enter sends a live probe and API key to the remote host without an affirmative choice, contrary to the explicit-consent rule. The later persistent project-consent prompt correctly defaults to false, but that does not undo the earlier probe. | Confirmed; default false and test Enter behavior |

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
- [ ] No production code has been changed in this audit branch yet. Findings are recorded as candidates; fixes begin only after the affected folder and its regression tests are fully traced.
- [x] Main CI baseline rechecked: run 43509121973 on main commit 81d7bf837254b8526b60aa240d6a31923647a890 completed successfully. docs/STATE.md still cites run #613 as failing and repeats the superseded Zod issue.

These are first-pass findings, not the final register. Continue reading the remaining files and verify each finding against tests/callers before changing behavior. Do not mark a folder complete until every file in its scope has been read and its imports/callers/tests have been traced.
