# Current project state

## 2026-11-21 current verified state

- Main commit: `0bbd15617f250d42484fd1164e383fda7aae7f5f`, PR #159 merged. Post-merge main CI #44832920650 passed all mandatory jobs.
- PR #158 merged cross-process semantic acceptance. Four independent writers added 200 facts, a separate process deleted 50, and tests verified cursor invalidation, sidecar rebuild to 150 live facts, and delete/reinsert ordering. PR-head CI #44831362470 and post-merge main CI #44831864535 both passed.
- PR #159 merged D-117 profile hardening. Neither built-in profile registers host `Subprocess`; `profile-coding` also rejects `router.needle` and disables host-backed `retrieval.grep`, `retrieval.rank`, and `retrieval.tools`. Regression tests verify the services are absent and configuration fails closed. PR-head CI #44832567598 passed.
- PR #161 merged a semantic crash-window test. It appends a valid durable event without updating the disposable sidecar/manifest, starts a fresh service instance, and verifies the index is rebuilt and both committed facts remain. PR-head CI #44833502733 passed.
- PR #157's performance benchmark and CI reporting changes are merged. The informational `acceptance gates NOT RUN` job is explicitly not acceptance; `ci-pass` requires all mandatory jobs.
- Phase 2 SQLite coordination is complete through PR #140, including transactional budget reservations, rate-limit windows/concurrency permits, and fenced leases.
- Phase 3 has bounded session-log reads, episodic indexes/pages, append-only semantic events, rebuildable semantic indexes, quotas, cursor invalidation, checkpointed reindex, a 100k semantic-page benchmark, and independent-process semantic writer/deletion tests. It remains open for crash-during-write/restart recovery, additional cross-process cache/session-log recovery, large-file memory bounds, and full audit closeout.
- Performance evidence and measurement caveats are in [architecture-contracts.md](architecture-contracts.md). The 100k semantic fixture had 25k deletions and one reinsertion. Cold index rebuild p50/p95 was 4,310.982/4,404.561 ms. Warm 50-row pages were 19.953/25.641 ms at cursor 49,999, 18.225/25.586 ms at 89,999, and 17.867/20.190 ms at 99,899. Sampled RSS delta p50/p95 was 25,427,968/26,869,760 bytes.
- Phase 4 now has a backend-neutral runtime orchestrator and a persistent Vercel session provider. PR #163 adds SQLite task-scoped sessions, fenced lifecycle transitions, hashed capabilities, path/operation/expiry authorization, and revocation. PR #165 wires WorkspaceRuntime to SQLiteLeaseStore for fenced create/execute/close and fail-closed cleanup. PR #175 adds VercelWorkspaceSessionProvider with project egress checks, deny-all networking, a dedicated unprivileged Linux user, durable scope tags, capability/fencing checks, bounded and secret-redacted output, and a required snapshot after initialization and every command. Provider-validated recovery/adoption after lease expiry, restart recovery, byte-level transfer, secret/symlink-safe enumeration, conflict-safe result application, and live Vercel acceptance remain open. PR #169 transfer validators are local-only and do not move bytes.
- D-110/D-117/D-118/D-119 remain binding. Built-in profiles no longer expose host subprocess execution, and the host-executable router backend is no longer exported from the runtime bundle. Generic Subprocess/retrieval bundles, Crabbox source, scripts, desktop paths, and downstream direct construction still require the full reachability audit. Do not enable `COMMAND_TOOL`.
- Live Vercel acceptance is not performed by CI. It requires explicit owner-run project egress authorization and credentials; the informational not-run job is not evidence of acceptance.

## Remaining execution queue

1. Finish the post-merge main CI run #44832920650.
2. Complete Phase 3 recovery from interruption during source append itself, cross-process session-log/cache recovery, and memory-bound evidence.
3. Finish the repository-wide D-110/D-117 subprocess and indirect execution audit.
4. Complete provider-validated Vercel recovery/adoption, restart recovery, source enumeration with secret/symlink/special-file exclusion, bounded byte transfer, conflict-safe governed apply, and cleanup when egress consent is revoked. Live Vercel acceptance remains owner-authorized and is not established by fake-client CI.
5. Complete the file-by-file audit and reconcile every active status document.
6. Run final migration, cross-platform, security, performance, documentation, and owner-authorized Vercel acceptance.

## Historical status snapshots

## Historical snapshot: unified completion-loop status (PR #156 baseline)

- Main commit: `2a2a60315a1e6db8b448c9c7d48a460c5bfb75b5`, merged from PR #156.
- PR #156 is merged. Its semantic insertion-order tombstone fix passed CI run #44826849470, all 10 jobs, including Ubuntu/Windows Node 20.19.0 and 22.12.0, typecheck, lint, tests, docs, security/dependencies, licenses, and architecture benchmarks.
- Post-merge main CI run #44827470725 was still in progress at the last status check. Docs, license inventory, security/dependency audit, Ubuntu Node 22.12, and architecture baseline had passed; the remaining platform test jobs were still running. Do not claim post-merge CI is complete until the run concludes.
- Phase 2 shared SQLite coordination is implemented through PR #140. The audit records the Windows Node 20 regression, legacy budget import, explicit task identity/shared task reservations, and LLMService shared-store integration as resolved; PR #140 CI run #918 passed the required matrix.
- Phase 3 implementation includes bounded session-log tail reads, indexed episodic identity and pages, append-only semantic events, rebuildable semantic indexes, bounded searchable-fact quotas, cursor invalidation, paged checkpointed reindex, and the 100k-event semantic-page benchmark. PR #170 adds a child-process crash test for partial semantic source append; PR #174 adds cross-process session-log tail-cache invalidation. PR #177 adds bounded retrieval-rank index preparation: hard file/byte/line/chunk limits, bounded per-file chunk emission, and fail-closed truncated file listings. PR #180 bounds semantic sidecar size by compacting it to live facts after rebuild and when historical index entries dominate, without trimming durable event history. Remaining Phase 3 work includes semantic reindex metadata scans, large prepared chunk lists outside retrieval-rank, and large-store/large-file memory evidence.
- CI run #44826849470 produced refreshed measurements for session-log/episodic paths, retrieval indexing, and 2,000-fact semantic reindex. Exact values and measurement caveats are in [architecture-contracts.md](architecture-contracts.md).
- The new `bench:semantic-page` script ran in CI architecture job #44828389243 on a 100k-event source with 25k deletions and one reinsertion. Cold index build p50/p95 was 4,310.982/4,404.561 ms; warm 50-row page p50/p95 was 19.953/25.641 ms at cursor 49,999, 18.225/25.586 ms at 89,999, and 17.867/20.190 ms at 99,899. Sampled RSS delta p50/p95 was 25,427,968/26,869,760 bytes. These are small-sample process-wide measurements; concurrent-writer and crash-recovery stress tests remain open.
- Phase 4 SQLite fenced leases, task-scoped session metadata, capability records, and the backend-neutral `WorkspaceRuntime` exist in PRs #163 and #165. The transfer contract and local validators now enforce separate file/entry quotas, canonical paths, deterministic manifests, bounded incremental chunk streaming, exact manifest-to-stream matching, common credential/private-key path rejection, and SHA-256 integrity. Provider file enumeration, actual remote byte transfer, secret/symlink exclusion, provider-side enforcement, conflict-safe result application, and crash recovery remain unimplemented.
- D-110/D-117/D-118 remain binding. The coding profile must not expose `run_command`; no host fallback, Docker/WSL/Crabbox, or implicit sandbox provider selection is allowed.
- Adapter-side Vercel output limits and fake-client tests exist. Live SDK buffering, remote termination, and end-to-end provider acceptance remain unverified and require explicit authorization and credentials.
- The CI workflow requires every mandatory verification job through `ci-pass`. The separate `acceptance gates NOT run by CI` job is informational and does not count as provider acceptance.
- The current Git tree contains 424 tracked files. The complete file-by-file and cross-folder audit is not finished. The 2026-11-07 file manifest is a historical inventory, not current review evidence.
- D-119 remains binding: one SQLite DB per project, supported local filesystems only, durable history retained indefinitely by default, and workspace resume only after lease expiry, explicit ownership acquisition, and provider-validated recovery.

## Historical SQLite Phase 2 snapshot (superseded by the unified status above)



- Current main baseline: `75574f337707460340bd2877c4a9b5a26ddaaef0`. PR #134 (independent-process SQLite rate-limit and lease tests) and PR #135 (stable rate-limit policies and bounded lease history) are merged.
- PR #135 head CI run #899 passed all mandatory jobs, including Ubuntu and Windows on Node 20.19.0 and 22.12.0. Its Vercel deployment check failed separately and is not GitHub Actions CI.
- PR #134 run #896 failed on Windows Node 20 during `npm test`; Ubuntu Node 20/22 and Windows Node 22 passed. The PR was merged, but this failure remains an unresolved cross-platform test defect. Do not describe cross-process acceptance as fully green until it is reproduced, fixed, and rerun.
- SQLite now includes shared session/day budget reservations, shared rate-limit windows/concurrency permits, fenced resource leases, stable rate-limit policy rows, and terminal lease-history cleanup that preserves fencing counters.
- Still open in Phase 2: investigate and fix the Windows Node 20 process-test failure; migrate legacy `Budgets.statePath` JSON counters without loss or double counting; add shared task-scope budget reservations with an explicit task identity; test complete LLMService shared-budget/rate-limit integration and migration/recovery behavior.
- Phase 3 indexed memory/retrieval, paging, quotas, and resumable reindex remain open. Phase 4 task-scoped workspace lifecycle/transfer/result synchronization remains open. Live Vercel acceptance, S6/S7, and the full file-by-file audit remain separate open gates. `COMMAND_TOOL` remains disabled; D-110/D-117/D-118/D-119 remain binding.


Updated 2026-11-20, main `71499dea7af36995a8e7e636a88d196c8e89002f`. PRs #128-130 are merged. PR #130 integrates shared session/day hard reservations into the model-call path; its PR-head CI run #881 passed. The merge commit's combined status currently reports a failed Vercel deployment context, which is separate from GitHub Actions CI. This file records the current implementation state and binding project constraints. The active implementation order is in [ROADMAP.md](ROADMAP.md), architecture choices are in [decisions.md](decisions.md), and detailed audit findings are in [CODEBASE-AUDIT-CHECKLIST.md](CODEBASE-AUDIT-CHECKLIST.md).

## 2026-11-20 current main status

- Current main baseline: `71499dea7af36995a8e7e636a88d196c8e89002f` (merge commit for PR #130). PR #128 merged the SQLite transaction/migration foundation; PR #129 merged the cross-process budget reservation store; PR #130 integrated shared session/day hard reservations into `BudgetGate`/`LLMService`. PR-head CI run #881 completed successfully. The merge commit's combined status currently reports a failed Vercel deployment context; this is not a GitHub Actions test result. The acceptance-gates job is a workflow status, not live-provider acceptance.
- PRs #113-130 are merged. PR #125 completes Markdown consolidation; PR #126 adds Vercel SIGTERM-at-cap handling; PR #127 reconciles the Vercel merge state; PR #128 adds the SQLite transaction/migration foundation. Earlier PRs add retrieval collection ownership and safer replacement, strict aggregate CI and full dependency auditing, bounded session/semantic/episodic queues, fail-closed D-117 smoke paths, bounded tool-output serialization, and batched semantic reindex. PR #129 merged the SQLite budget store; PR #130 integrated shared session/day hard reservations into `BudgetGate`/`LLMService`.
- PR #126 sends SIGTERM through `Command.kill()` when either Vercel stream exceeds its cap, then drains until the SDK iterator settles. Its fake-client tests verify the kill request, not remote process-tree termination or SDK-internal buffering. Live Vercel acceptance remains open; stale PR #123 was closed as superseded.
- Session-log append queues are bounded at 1024 outstanding operations per session; completed queue entries are released and the sequence cache is capped at 256. A validated tail cursor avoids full scans for same-process JSONL appends, but cursor invalidation after restart or external-process writes can still trigger a full scan.
- Semantic operations are bounded at 256 outstanding operations per service. Persistent episodic writes are bounded at 1024 outstanding operations per store. These limits do not replace D-119's shared SQLite backend, indexed episode identity, durable-history paging, or retention policy.
- Tool output for plain objects/arrays is serialized incrementally with a character cap plus 10,000-node and 32-level limits. Vercel stdout/stderr capture uses the SDK async logs iterator and bounded per-stream UTF-8 buffers. PR #126 sends SIGTERM when either stream exceeds its cap and continues draining until the iterator settles. Live SDK internal buffering and remote termination acceptance remain open.
- D-117 host execution paths in `smoke-coding.ts`, `smoke-phase2.ts`, and `run-logged.mjs` now fail closed. No host subprocess, generated-code execution, or local fallback was used.
- Semantic fact-array paging and resumable reindex remain open despite bounded 64-fact embedding/upsert batches. Shared rate-limit/concurrency reservations, workspace lease metadata and task-scoped transfer/result synchronization, provider lifecycle acceptance, live Vercel execution, S6, and S7 remain open. `COMMAND_TOOL` remains disabled. D-110/D-117/D-118/D-119 remain binding.

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
