# Build plan

Updated 2026-11-21 against main `2a2a60315a1e6db8b448c9c7d48a460c5bfb75b5`. This is the short execution queue. The detailed order and phase exit criteria are in [ROADMAP.md](ROADMAP.md); current evidence and blockers are in [STATE.md](STATE.md).

## Current work queue

- [x] **B0: Merge semantic cursor fix.** PR #156 merged; CI run #44826849470 and post-merge main run #44827470725 passed all 10 jobs.
- [x] **B1: Semantic page performance benchmark.** CI architecture job #44828389243 measured cold index build at 4,310.982/4,404.561 ms p50/p95; warm 50-row pages at early/middle/late cursors were 19.953/25.641, 18.225/25.586, and 17.867/20.190 ms p50/p95; sampled RSS delta was 25,427,968/26,869,760 bytes p50/p95. The fixture included 100k puts, 25k deletes, and one reinsertion. Large-store concurrency and recovery stress tests remain open.
- [ ] **B2: Memory recovery and bounds.** Verify cursor invalidation, sidecar rebuild, torn-tail recovery, quota behavior, interrupted reindex, and deletion-heavy index compaction. Profile metadata scans and large prepared chunk lists.
- [ ] **B3: Phase 4 workspace runtime.** Implement SQLite lease/fencing integration, task-scoped workspace lifecycle, explicit ownership, and crash recovery.
- [ ] **B4: Workspace capabilities and transfer.** Add operation/path/expiry-bound capabilities, revocation, deterministic secret-safe snapshots, bounded upload/collection, hash validation, conflict detection, and governed result application.
- [ ] **B5: D-110/D-117 security trace.** Audit every CLI/profile/tool/provider route for indirect host execution, subprocess fallback, implicit provider selection, and Crabbox/Docker/WSL reachability. Preserve hard denials and keep `COMMAND_TOOL` disabled.
- [ ] **B6: CI acceptance reporting.** Keep `ci-pass` strict for all mandatory jobs and make not-run provider gates visibly informational. Do not count fake-client tests as live acceptance.
- [ ] **B7: Full source and cross-folder audit.** Review all tracked source, tests, scripts, desktop code, generated files, configuration, docs, and call paths. Record evidence and disposition for each finding.
- [ ] **B8: Documentation reconciliation.** Synchronize ROADMAP, STATE, BUILD-PLAN, architecture contracts, audit checklist, and historical status labels from verified code and CI evidence.
- [ ] **B9: Final acceptance.** Run migration, cross-process, recovery, security, compatibility, performance, and Ubuntu/Windows Node 20/22 CI. Close phases only when their exit evidence is complete.
- [ ] **B10: Live Vercel acceptance.** Owner-run only after explicit egress authorization, credentials, safe workspace transfer, result synchronization, lifecycle audit, and cleanup checks are available. S6/S7 remain separate evidence gates.

## Guardrails

- D-110: no Docker, WSL, Crabbox, or host execution.
- D-117: cloud sandbox only; no local or host fallback.
- D-118: Vercel Sandbox is the first provider, not yet end-to-end accepted.
- Never enable `COMMAND_TOOL` before workspace transfer, result sync, lifecycle audit, and policy tests pass.
- D-119: one SQLite DB per project, supported local filesystems only, durable history retained indefinitely by default, guarded workspace recovery.
- Do not weaken policy, suppress dependency audit, or fabricate acceptance evidence.

## Completion reporting

Report implementation, unit tests, CI, live smoke, and owner acceptance separately. A green CI run or fake-client test is not live cloud acceptance.
