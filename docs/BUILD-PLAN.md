# Build plan

Updated 2026-11-21 against main `d0c2639a834841e70002a3e32f1b5068ac15d2ef` (PR #165 merged). Post-merge main CI #44837164572 is in progress. This is the active execution queue; detailed exit criteria are in [ROADMAP.md](ROADMAP.md), with evidence and blockers in [STATE.md](STATE.md).

## Current work queue

- [x] **B0: Merge and verify semantic scaling acceptance.** PR #158 merged; four independent writers added 200 facts, a separate process deleted 50, and the test verified cross-process cursor invalidation, sidecar rebuild, and delete/reinsert ordering. PR-head CI #44831362470 and post-merge main CI #44831864535 passed.
- [x] **B1: Publish Phase 3 performance evidence.** PR #157 merged. The 100k semantic fixture included 25k deletions and one reinsertion. Cold sidecar rebuild p50/p95: 4,310.982/4,404.561 ms. Warm 50-row pages p50/p95: 19.953/25.641 ms (cursor 49,999), 18.225/25.586 ms (89,999), and 17.867/20.190 ms (99,899). Sampled process RSS delta p50/p95: 25,427,968/26,869,760 bytes. Other episodic, retrieval-indexing, and semantic-reindex measurements are recorded in [architecture-contracts.md](architecture-contracts.md). Small sample counts and process-wide RSS limits are documented there.
- [~] **B2: Finish Phase 3 recovery and memory bounds.** PR #161 covers interruption after the authoritative semantic event append but before sidecar/manifest update. PR #170 adds a child-process crash after a synced partial semantic source record. PR #174 adds cross-process session-log cursor invalidation. PR #177 adds hard bounds for retrieval-rank file listings, source bytes, line counts, per-file chunk generation, prepared chunk count, and prepared text bytes; over-limit indexing fails before vector-store mutation. Still inspect semantic reindex metadata scans, large prepared chunk lists outside retrieval-rank, and large-store/large-file memory behavior.
- [~] **B3: Implement Phase 4 workspace runtime.** PR #163 adds durable task-scoped session metadata, idempotent creation, fenced lifecycle transitions/adoption, and capability records. PR #165 adds the backend-neutral orchestrator wired to SQLiteLeaseStore. PR #175 adds VercelWorkspaceSessionProvider with persistent sandbox creation/reattachment, project egress consent, deny-all networking, a dedicated unprivileged Linux user, scope-tag verification, SQLite capability/fencing checks, bounded and secret-redacted output, and a required snapshot after initialization and every command. Still implement provider-validated recovery/adoption after lease expiry, restart recovery, and cleanup when egress consent is revoked.
- [~] **B4: Implement workspace capabilities and transfer.** PR #163 persists SHA-256 capability digests and enforces project/task/session/workspace binding, fencing token, operations, path prefixes, expiry, and revocation. PR #165 checks the grant and lease before command execution. PR #169 adds local validators for separate file/entry quotas, canonical paths and known-secret-path rejection, deterministic manifests, bounded incremental chunk streams, exact manifest-to-stream matching, per-file and manifest SHA-256 integrity, and collision/byte-accounting rejection. PR #175 implements Vercel session execution only. Still implement provider-side source enumeration with secret/symlink/special-file exclusion, actual bounded byte transfer, conflict-safe governed apply, provider recovery, and cleanup.
- [~] **B5: Enforce D-110/D-117 built-in profile boundaries.** PR #159 merged and passed full PR-head CI: both built-in profiles omit host `Subprocess`; coding profile rejects `router.needle` and host-backed retrieval. Continue tracing generic exported bundles, direct downstream construction, scripts, desktop paths, and all subprocess consumers. Keep `COMMAND_TOOL` disabled.
- [x] **B6: Strengthen CI acceptance reporting.** PR #157 merged. `ci-pass` requires all mandatory jobs; acceptance gates not run remain explicitly informational and cannot be counted as live provider acceptance.
- [ ] **B7: Complete full source and cross-folder audit.** Inspect all tracked source, tests, scripts, desktop code, generated files, configuration, docs, and call paths. Record duplicates, stale code, hardcoded assumptions, unbounded operations, unsafe defaults, and evidence for every disposition.
- [ ] **B8: Reconcile documentation.** This PR updates active ROADMAP, STATE, BUILD-PLAN, architecture contracts, and audit evidence to the latest merged PRs. Continue removing or clearly labelling stale historical status blocks; verify all docs against code and CI before closing.
- [ ] **B9: Run final acceptance.** Verify migration safety, cross-process behavior, crash recovery, security, compatibility, performance, docs, and Ubuntu/Windows Node 20/22 CI. Close phases only when their exit evidence is complete.
- [ ] **B10: Run live Vercel acceptance.** Owner-run only after explicit project egress authorization, credentials, safe workspace transfer, result synchronization, lifecycle audit, and cleanup checks. S6/S7 remain separate evidence gates.

## Guardrails

- D-110: no Docker, WSL, Crabbox, or host execution.
- D-117: cloud sandbox only; no local or host fallback.
- D-118: Vercel Sandbox is the first provider, not yet end-to-end accepted.
- Never enable `COMMAND_TOOL` before workspace transfer, result sync, lifecycle audit, and policy tests pass.
- D-119: one SQLite DB per project, supported local filesystems only, durable history retained indefinitely by default, guarded workspace recovery.
- Do not weaken policy, suppress dependency audit, or fabricate acceptance evidence.

## Completion reporting

Report implementation, unit tests, CI, live smoke, and owner acceptance separately. A green CI run or fake-client test is not live cloud acceptance.
