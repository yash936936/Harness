# Current project state

Updated 2026-11-16, main `0e2e38d5ea9e5b40d74422abccda4d9173c00b33`. PR #128 merged the SQLite transaction/migration foundation and PR #129 merged the cross-process budget reservation store. PR #130 integrates shared session/day reservations into the model-call path and is awaiting CI. This file records the current implementation state and binding project constraints. The active implementation order is in [ROADMAP.md](ROADMAP.md), architecture choices are in [decisions.md](decisions.md), and detailed audit findings are in [CODEBASE-AUDIT-CHECKLIST.md](CODEBASE-AUDIT-CHECKLIST.md).

## 2026-11-16 current main status

- Current main baseline: `0e2e38d5ea9e5b40d74422abccda4d9173c00b33`. PR #126 merged SIGTERM cancellation when Vercel output exceeds either per-stream cap. PR #128 merged the SQLite transaction/migration foundation; PR #129 merged the cross-process budget reservation store; post-merge main CI run #862 passed all 10 jobs. PR #130 integrates shared session/day hard reservations; its CI is pending. The acceptance-gates job is a workflow status, not live-provider acceptance.
- PRs #113-129 are merged. PR #125 completes Markdown consolidation; PR #126 adds Vercel SIGTERM-at-cap handling; PR #127 reconciles the Vercel merge state; PR #128 adds the SQLite transaction/migration foundation. Earlier PRs add retrieval collection ownership and safer replacement, strict aggregate CI and full dependency auditing, bounded session/semantic/episodic queues, fail-closed D-117 smoke paths, bounded tool-output serialization, and batched semantic reindex. PR #129 merged the SQLite budget store; PR #130 integrates shared session/day hard reservations into `BudgetGate`/`LLMService`.
- PR #126 sends SIGTERM through `Command.kill()` when either Vercel stream exceeds its cap, then drains until the SDK iterator settles. Its fake-client tests verify the kill request, not remote process-tree termination or SDK-internal buffering. Live Vercel acceptance remains open; stale PR #123 was closed as superseded.
- Session-log append queues are bounded at 1024 outstanding operations per session; completed queue entries are released and the sequence cache is capped at 256. A validated tail cursor avoids full scans for same-process JSONL appends, but cursor invalidation after restart or external-process writes can still trigger a full scan.
- Semantic operations are bounded at 256 outstanding operations per service. Persistent episodic writes are bounded at 1024 outstanding operations per store. These limits do not replace D-119's shared SQLite backend, indexed episode identity, durable-history paging, or retention policy.
- Tool output for plain objects/arrays is serialized incrementally with a character cap plus 10,000-node and 32-level limits. Vercel stdout/stderr capture uses the SDK async logs iterator and bounded per-stream UTF-8 buffers. Main still drains after the output cap; PR #123 proposes cancellation at the cap. Live SDK internal buffering and remote termination acceptance remain open.
- D-117 host execution paths in `smoke-coding.ts`, `smoke-phase2.ts`, and `run-logged.mjs` now fail closed. No host subprocess, generated-code execution, or local fallback was used.
- Semantic fact-array paging and resumable reindex remain open despite bounded 64-fact embedding/upsert batches. Shared-state SQLite, task-scoped workspace transfer/result synchronization, provider lifecycle acceptance, live Vercel execution, S6, and S7 remain open. `COMMAND_TOOL` remains disabled. D-110/D-117/D-118/D-119 remain binding.

## 2026-11-14 open architecture work and streaming follow-up

- Current main baseline: 74ae26a6273ff0fd2267e6d2ebf4b78df72bc9d1. The checkout for this session is detached at this commit.
- The Vercel SDK @vercel/sandbox@3.9.1 supports detached commands with an async Command.logs() iterator. The adapter now consumes that iterator and retains at most maxOutputBytes per stream, preserving complete UTF-8 code points and adding a truncation marker.
- Focused fake-client coverage now exercises independent stream caps and a multi-byte UTF-8 boundary. This is adapter acceptance only, not live Vercel acceptance.
- Live Vercel execution remains blocked: this sandbox has no Vercel credentials in its environment, and its network allow-list intentionally excludes Vercel control-plane hosts. No egress consent or allow-list change was made.
- Cross-process SQLite reservation acceptance remains blocked because this main commit has no SQLite runtime/provider implementation. The existing reservation benchmark is a negative baseline: at a daily hard limit of one, 2/4/8 independent processes accept 2/4/8 reservations, respectively. It does not demonstrate a transactional shared backend.
- Task-scoped workspace acceptance remains blocked because only type contracts and design rules exist. Workspace lifecycle, capability enforcement, transfer, synchronization, and recovery are not implemented. COMMAND_TOOL remains disabled under D-118.
- Architecture benchmarks were rerun on Node 22.23.5, Linux x64, 2 vCPUs. Session-log append at 100k events: p50 120.151 ms / p95 125.015 ms. Episodic duplicate check at 100k: p50 329.936 ms / p95 348.579 ms. Selective episode query: p50 183.223 ms / p95 192.947 ms.
- Retrieval indexing: 1,740 chunks, p50 548.634 ms / p95 617.717 ms, 7 embedding calls, 512-chunk groups; total prepared chunks remain in memory. Semantic reindex: 2,000 facts, 64-item embedding batches; source facts remain loaded as a full array and vector-upsert paging still needs review.
- Streaming output benchmark: fake SDK emitted 99k, 100k, 1m, and 8m characters per stream in 64 KiB chunks. At 1m and 8m, retained output was 100,038 bytes per stream including the truncation marker. At 8m, p50 25.761 ms / p95 38.410 ms. RSS is process-wide and sampled, not a strict peak-memory proof.
- Full file-by-file audit is explicitly excluded from this closeout request and remains open.

## Binding decisions

| Decision | Current rule |
|---|---|
| D-110 | S0 / Docker, WSL, Crabbox is PERMANENT-HOLD. S1 is deferred. No probes, retries, diagnostics, or workarounds. |
| D-117 | Development commands may run only in an explicitly selected remote cloud sandbox. No host/local fallback. |
| D-118 | Vercel Sandbox is the first cloud provider. Provider selection is not integration or acceptance. |
| D-119 | SQLite is the first shared transactional backend behind domain interfaces; add capability-based task workspaces alongside the one-shot API; separate durable history from bounded searchable memory; preserve public APIs, providers, and persisted formats. Initial policy: multi-process/single-host only on supported local filesystems, one database per project, no automatic durable-history deletion, and crash resume only after lease expiry, explicit ownership, and provider-validated recovery. |
| D-116 D3 / D-109 | Three demo sessions are qualitative. Scoring requires 10+ genuine sessions (20+ if available), with owner-authored good/bad labels committed and hashed before scoring. |
| D-115 | Research prototype only. No package, release, hosted distribution, or model-weight distribution. |
| D-114 | Qwen 7B artifact work is excluded. |

## Implementation status

| Area | State | Boundary |
|---|---|---|
| Core harness, profiles, tools, policy gates, retrieval, memory, orchestrator | Implemented; CI-tested | CI does not establish live model quality or external acceptance. |
| Sandbox service and provider contract | Implemented | Provider presence is not live execution proof. |
| Vercel Sandbox adapter | Implemented; fake-client tested | Non-persistent, deny-all, argv-only execution with cleanup attempt. Not live-verified. |
| Workspace transfer and result synchronization | Not implemented | No project snapshot transfer or conflict-safe result application. |
| Provider lifecycle audit | Incomplete | Must capture request, lease, command, timeout/cancel, cleanup, and failures. |
| Coding profile command tool | Disabled | Do not enable `run_command` until workspace transfer, result sync, lifecycle audit, and policy integration are accepted. |
| Shared-state SQLite provider | Budget path integrated in PR #130 | `SQLiteDatabase` and `SQLiteBudgetReservationStore` are merged. PR #130 wires shared session/day hard reservations into `BudgetGate`/`LLMService` and enables them in the coding profile. Rate-limit windows, concurrency permits, workspace leases, and legacy `statePath` migration remain open. |
| Architecture contracts | Contracts merged via PR #94; SQLite foundation/store merged via PRs #128-129 | Backend-neutral contracts and migration specification are implemented. PR #130 wires `SQLiteBudgetReservationStore` into `BudgetGate`/`LLMService` for session/day hard limits. Rate-limit windows, concurrency permits, task scope, and workspace leases remain open. Four D-119 policy choices approved. Session-log/episodic baselines captured by PR #95 and Windows measurements by PR #97. Independent-process budget reservation baseline captured by PR #99; it confirms current cross-process oversubscription. Deterministic indexing baseline captured in CI run #749: 31 files, 1,740 chunks, including one 540-chunk file; p50 306.759 ms and median observed RSS delta 24,248,320 bytes. Semantic-reindex pre-batching baseline captured in CI run #752: 2,000 facts, 32 embedding requests, one 2,000-vector upsert; p50 78.332 ms and median observed RSS delta 5,005,312 bytes. PR #121 adds 64-fact embedding and vector-upsert batches; CI run #43757666162 measured 32 upserts for 2,000 facts, p50 193.104 ms, p50 observed RSS delta 1,941,504 bytes, and a 67,715,072-byte maximum across three samples. The full fact array remains loaded and reindex is not resumable. Output capture/truncation baseline captured in CI run #759 (99k/100k/1M/8M characters per stream). At 8 MB per stream, p50 adapter time was 24.942 ms and median observed RSS delta was 16,011,264 bytes; returned output was 100,038 bytes per stream including the marker. Vercel now uses the SDK async logs iterator with bounded per-stream capture; live SDK internal buffering and cancel-at-cap are not yet accepted. |
| Memory scaling changes | Partially implemented | Queue growth and selected caches are bounded by PRs #115-117. AUD-007/008 history scans, AUD-014 retention/paging, and AUD-025 resumable semantic reindex remain open. |
| Streaming output enforcement | Partially implemented | Vercel uses async SDK logs, bounded per-stream capture, and SIGTERM at the cap; generic tool serialization is bounded by PR #119. Live SDK buffering and remote termination acceptance remain open. |

## Acceptance state

| Gate | State | Required evidence |
|---|---|---|
| S0 | PERMANENT-HOLD | No further work under D-110. |
| S1 | DEFERRED | Depends on S0. |
| S3 | CLOSED (D-111) | File-tool/policy acceptance only. No sandbox acceptance implied. |
| S4 | OPEN, CLOUD-ONLY PLAN | Complete governed Vercel workflow with live evidence. Not passed. |
| S5 / ENG-04 | OUT OF SCOPE (D-115) | Reopen only if distribution is approved. |
| S6 | OPEN | D-109 genuine-session and owner-label requirements. |
| S7 | OPEN / RECONCILE | Reconcile historical embedding/poisoning evidence with current main; rerun only missing or stale checks. |
| R3 demo | NOT STARTED | Three qualitative sessions, reviewed summary, measured cold start, Windows quickstart, and demo script. |

## CI and merge status

- PR #93, `audit/full-codebase-review-2026-11`, merged on 2026-11-14 as `8ee08673bd03b8548c44612093b447fadb03ce26`.
- PR #97, `audit/windows-baselines-undici-fix-2026-11`, merged on 2026-11-14 as `5aaee0dacdaace04959db508260a84590e941a0c`. It records Windows x64 / Node v22.18.0 session-log and episodic-memory baselines and pins the nested `guarded-fetch` Undici dependency to 7.30.2; the generated license inventory is synchronized.
- PR #98, `docs/phase1-closeout-sync-2026-11`, merged on 2026-11-14 as `9e508b472b60a561c8e197cdea27813269833011`, synchronizes the approved D-119 policy and Windows baseline status.\n- PR #102, skill symlink escape hardening, merged on 2026-11-14 as `082e83629ea20ead62e001cf27357bd4952fd6a5`; CI run #777 passed all OS/Node jobs and `ci-pass`.\n- PR #103, semantic vector write-order hardening, merged on 2026-11-14 as `0bb27968955b218c5ea188f35b3d0939623a32cb`; follow-up CI run #780 passed all OS/Node jobs and `ci-pass`.
- CI run #724 on PR head `5741d23058dca0dc0112810e6c35fa87a47e8d0f` passed: Ubuntu and Windows on Node 20.19.0 and 22.12.0, typecheck, lint, full tests, docs/component drift, secret scan, dependency audit, license inventory, and `ci-pass`.
- The green run verifies the PR head. It is not a live sandbox/model acceptance result.
- Phase 0 is complete. Phase 1 contracts and D-119 policy decisions merged in PR #94. Initial numeric baselines merged in PR #95; Windows baselines merged in PR #97; the independent-process reservation baseline was captured in PR #99 (CI run #744). Reservation measurements in CI run #744 confirm oversubscription in the current process-local implementation. Numeric output capture baseline is recorded; true bounded streaming requires a provider contract change and remains an open architecture limitation.

## D-119 approved deployment and operating policy

The four owner decisions are approved and binding for the initial implementation:

1. **Topology:** multiple local processes on one host, using a supported local filesystem. Multi-machine shared state and arbitrary network filesystems are unsupported.
2. **Database ownership:** one SQLite database per project.
3. **Durable history:** retain indefinitely by default. No automatic deletion. A retention or deletion workflow requires a separate approved policy.
4. **Crash recovery:** resume only after lease expiry, explicit acquisition of ownership, and provider-validated recovery. Otherwise create a fresh workspace.

These constraints must be enforced in the Phase 2 design and tests. Changing them requires a new decision record and migration review.

## Confirmed architecture findings and remaining work

| Findings | Required work |
|---|---|
| AUD-007, AUD-008 | Tail cursor reduces same-process session-log scans; episodic writes are bounded. Remove remaining external-change/full-history scans and add indexed episode identity lookup and paging. |
| AUD-014, AUD-025 | Queue bounds and 64-fact semantic embedding/vector-upsert batches are implemented. Add durable-history paging, searchable-memory quotas, paged fact loading, and resumable semantic reindexing. |
| AUD-015, AUD-044 | PR #130 wires shared budget reservations into `BudgetGate`/`LLMService`; migrate rate-limit windows and concurrency permits to shared transactions. |
| AUD-016 | Collection ownership and safer replacement are implemented in PR #113. Bound large-file indexing memory and evaluate vector-search scaling. |

| AUD-023 | Main has bounded Vercel log capture and sends SIGTERM at the cap, then drains until the SDK iterator settles. Live SDK internal buffering and remote process-tree termination remain unverified. |
| AUD-039 | Add task-scoped workspace lifecycle, capabilities, leases, transfer, and result synchronization. |
| AUD-048 | Fixed in main via PR #101: session-log files, locks, and listing reject symlinked parent directories; expanded head passed CI run #768. |
| AUD-049 | Fixed in main via PR #101: compaction ledger no-follow reads, parent validation, and unique exclusive temp-file replacement; CI run #768 passed. |
| AUD-050 | Fixed in PR #102, merged as `082e83629ea20ead62e001cf27357bd4952fd6a5`; CI run #777 passed all OS/Node jobs and `ci-pass`. |
| AUD-051 | Fixed in PR #103, merged as `0bb27968955b218c5ea188f35b3d0939623a32cb`; CI run #780 passed all OS/Node jobs and `ci-pass`. Semantic vector writes now verify the current fact version under the shared lock; delayed removals cannot delete replacements. |
| Audit remainder | Complete the file-by-file audit and verify each checklist status against code and tests. |

AUD-021 is fixed in main: late sandbox creation is awaited, cleanup is confirmed before cancellation returns, and cleanup failure is surfaced by the adapter. The command tool fails the task when `released` is false. AUD-048 and AUD-049 are fixed in main through PR #101; the expanded head passed CI run #768 and the final documentation-only head passed run #773. AUD-050 is fixed in main through PR #102 (run #777). AUD-051 is fixed in main through PR #103 (run #780). PR #113 fixes collection ownership and safer replacement; PR #114 fixes aggregate CI gating and audits dev dependencies; PRs #115-117 bound memory queues/caches; PR #118 disables host execution paths under D-117; PR #119 bounds tool-output serialization.

Withdrawn findings AUD-009, AUD-022, and AUD-027 remain withdrawn unless new evidence changes the conclusion.

## Security boundaries

- No Docker, WSL, Crabbox, host command probes, local execution fallback, or host-backed project search in the coding profile.
- No automatic sandbox provider selection.
- No `run_command` exposure in the coding profile.
- Keep model-provider and sandbox-provider consent separate. Sandbox network access remains deny-all by default.
- Fake-client tests and CI do not count as live S4 acceptance.
