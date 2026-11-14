# Current project state

Updated 2026-11-14. This file records the current implementation state and binding project constraints. The active implementation order is in [ROADMAP.md](ROADMAP.md), architecture choices are in [decisions.md](decisions.md), and detailed audit findings are in [CODEBASE-AUDIT-CHECKLIST.md](CODEBASE-AUDIT-CHECKLIST.md).

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
| Shared-state SQLite provider | Not implemented | Phase 2, after Phase 1 policy gates. |
| Architecture contracts | Merged via PR #94 | Type-only interfaces and migration specification; no runtime changes. Four D-119 policy choices approved. Session-log/episodic baselines captured by PR #95 and Windows measurements by PR #97. Independent-process budget reservation baseline captured by PR #99; it confirms current cross-process oversubscription. Deterministic indexing baseline captured in CI run #749: 31 files, 1,740 chunks, including one 540-chunk file; p50 306.759 ms and median observed RSS delta 24,248,320 bytes. Semantic-reindex baseline captured in CI run #752: 2,000 facts, 32 embedding requests, one 2,000-vector upsert; p50 78.332 ms and median observed RSS delta 5,005,312 bytes. Output capture/truncation workload (99k/100k/1M/8M characters per stream) is wired into CI; numeric results are pending. True bounded streaming remains unsupported by the current Promise<string> SDK contract. |
| Memory scaling changes | Not implemented | AUD-007/008/014/025 remain open. |
| Streaming output enforcement | Not implemented | AUD-023 remains open. |

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
- PR #98, `docs/phase1-closeout-sync-2026-11`, merged on 2026-11-14 as `9e508b472b60a561c8e197cdea27813269833011`, synchronizes the approved D-119 policy and Windows baseline status.
- CI run #724 on PR head `5741d23058dca0dc0112810e6c35fa87a47e8d0f` passed: Ubuntu and Windows on Node 20.19.0 and 22.12.0, typecheck, lint, full tests, docs/component drift, secret scan, dependency audit, license inventory, and `ci-pass`.
- The green run verifies the PR head. It is not a live sandbox/model acceptance result.
- Phase 0 is complete. Phase 1 contracts and D-119 policy decisions merged in PR #94. Initial numeric baselines merged in PR #95; Windows baselines merged in PR #97; the independent-process reservation baseline was captured in PR #99 (CI run #744). Reservation measurements in CI run #744 confirm oversubscription in the current process-local implementation. Output capture numeric results remain before Phase 1 can close; true bounded streaming requires a provider contract change.

## D-119 approved deployment and operating policy

The four owner decisions are approved and binding for the initial implementation:

1. **Topology:** multiple local processes on one host, using a supported local filesystem. Multi-machine shared state and arbitrary network filesystems are unsupported.
2. **Database ownership:** one SQLite database per project.
3. **Durable history:** retain indefinitely by default. No automatic deletion. A retention or deletion workflow requires a separate approved policy.
4. **Crash recovery:** resume only after lease expiry, explicit acquisition of ownership, and provider-validated recovery. Otherwise create a fresh workspace.

These constraints must be enforced in the Phase 2 design and tests. Changing them requires a new decision record and migration review.

## Open confirmed architecture findings

| Findings | Required work |
|---|---|
| AUD-007, AUD-008 | Remove full-history scans from session-log and episodic-memory append/duplicate paths. |
| AUD-014, AUD-025 | Add bounded searchable memory, pagination, quotas, and resumable semantic reindexing. |
| AUD-015, AUD-044 | Move budget, rate-limit, and concurrency reservations to transactional shared state. |
| AUD-016 | Bound indexing memory and evaluate vector-search scaling. |
| AUD-021 | Await and report cleanup after late sandbox-create cancellation. |
| AUD-023 | Enforce output byte limits while streaming with bounded buffering. |
| AUD-039 | Add task-scoped workspace lifecycle, capabilities, leases, transfer, and result synchronization. |
| Audit remainder | Complete the file-by-file audit and verify each checklist status against code and tests. |

Withdrawn findings AUD-009, AUD-022, and AUD-027 remain withdrawn unless new evidence changes the conclusion.

## Security boundaries

- No Docker, WSL, Crabbox, host command probes, local execution fallback, or host-backed project search in the coding profile.
- No automatic sandbox provider selection.
- No `run_command` exposure in the coding profile.
- Keep model-provider and sandbox-provider consent separate. Sandbox network access remains deny-all by default.
- Fake-client tests and CI do not count as live S4 acceptance.
