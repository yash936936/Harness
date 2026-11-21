# Historical status log

> This file is a dated implementation history, not the active project status. Use [STATE.md](STATE.md) for verified current state and [ROADMAP.md](ROADMAP.md) for the active completion order.

## 2026-11-21 router host process boundary

- Moved CommandBackend and its process/hash helpers from src/bundles/router/backends.ts into scripts/router-command-backend.ts.
- scripts/eval-router.ts and the dedicated router tests import the evaluation-only adapter directly. The runtime router bundle no longer exports a host-executable backend.
- Added a regression test asserting CommandBackend is absent from the runtime router export surface.
- This does not close the full D-110/D-117 audit: the generic Subprocess service, local retrieval bundles, Crabbox source, other scripts, desktop paths, and downstream construction still need reachability review.
## 2026-11-21 persistent Vercel workspace session provider (PR #175)

- Added VercelWorkspaceSessionProvider alongside the one-shot Vercel adapter. It creates persistent Vercel sandboxes with deny-all networking, a dedicated unprivileged Linux user, hashed scope tags, and bounded snapshot retention.
- Remote create/get/snapshot/delete operations require project-matched egress consent and the exact vercel.com allowlist. Execution rechecks SQLite session ownership, capability scope/revocation, and the current lease fencing token.
- Commands use argv, a canonical workspace-relative working directory with realpath containment checks, a combined output-byte cap, registered-secret redaction, and bounded timeout/cancellation handling. Truncated output is suppressed entirely to avoid partial-secret disclosure.
- Sandbox.snapshot() must return status=created after initialization and every command. This captures the filesystem and stops the VM between calls, so guest processes do not survive while workspace files persist. Close confirms sandbox deletion and requests asynchronous orphan-snapshot deletion.
- Fake-client tests cover lifecycle, egress, scope-tag mismatch, capability path/revocation, stale fencing, output caps, timeout, secret redaction, and cleanup failure. Mandatory Ubuntu/Windows Node 20/22 PR CI passed.
- This is not live Vercel acceptance. Provider-validated recovery/adoption, restart recovery, byte transfer, secret/symlink-safe source enumeration, conflict-safe apply, and CLI registration remain open. COMMAND_TOOL remains disabled.

## 2026-11-21 bounded retrieval-rank index preparation (PR #177)

- Added configurable and hard-capped limits for raw file paths, total source bytes, line count, per-file chunk count, total prepared chunks, and prepared UTF-8 chunk bytes.
- Chunk generation enforces count and byte budgets incrementally rather than building unbounded chunk arrays first.
- retrieval-rank rejects truncated ripgrep file listings and over-budget index batches before vector-store mutation. Excessive line counts are rejected before creating the line array; search skips files exceeding per-file chunk limits.
- Added regression tests for hard ceilings, source/list/chunk budgets, line-count rejection, and no vector-store open on preparation-limit failures.
- This bounds retrieval-rank preparation only. Semantic reindex metadata scans, other prepared chunk lists, and measured large-store/large-file memory remain open.

## 2026-11-16 shared budget enforcement integrated (PR #130)

- Main baseline: `0e2e38d5ea9e5b40d74422abccda4d9173c00b33`. PR #129 merged the SQLite budget reservation store after its initial Windows CI failure exposed concurrent read handles blocking atomic replacement. The fix makes existing-file readers share the cross-process lock; the full matrix passed on the corrected head.
- PR #130 wires shared SQLite reservations into `BudgetGate` and `LLMService`. The coding profile automatically uses `.harness/state.sqlite` per project when hard limits are configured. Shared session/day hard limits reserve before dispatch, settle actual usage, release unused capacity, and fail closed when the store is unavailable.
- Added two-service and two-profile tests that share one database and prove a second call cannot pass a session hard limit while the first call is in flight. Shared usage is available through `statusAsync(sessionId)`; synchronous status remains process-local.
- The legacy `budgets.statePath` cannot be combined with shared reservations yet. Rate-limit windows/concurrency permits and workspace leases are still not migrated. PR #130 CI is pending.
- No local commands were run; GitHub Actions is the test environment under D-117.

---

## 2026-11-16 SQLite budget reservation store started (PR #129)

- Main baseline: `5ebd1156c31c02b62e79f779becbb4ef7dd05dab`. PR #128's SQLite transaction/migration foundation merged; post-merge main CI run #852 passed all 10 jobs.
- PR #129 adds `SQLiteBudgetReservationStore` implementing the shared budget reservation contract: committed usage plus active reservation checks, hard-limit consistency, accepted/rejected idempotency, one-time actual-usage settlement, release, expiry, and bounded cleanup.
- Its independent-process test starts six workers against a hard limit of one and expects exactly one reservation to succeed. PR #129 CI is pending.
- This store is not yet integrated into `Budgets`, `BudgetGate`, or `LLMService`. Existing runtime budget enforcement remains process-local. Shared rate-limit windows, concurrency permits, and workspace leases remain open.
- No local commands were run; GitHub Actions is the test environment under D-117.

---

## 2026-11-16 SQLite shared-state foundation started (PR #128)

- Main baseline: `09ebc945ae27713f8c531bf99c243c484f6281d9`. PR #126's post-merge main CI run #847 passed all 10 jobs; PR #127 documentation reconciliation passed its full 10-job matrix and was merged.
- PR #128 adds `SQLiteDatabase` using sql.js WebAssembly, the existing cross-process file lock, atomic file replacement, and ordered/checksummed migrations. Tests cover read-only planning, migration application, stale plans, checksum drift, rollback, symlink refusal, and independent-process updates.
- This foundation reloads and exports the full database on each write, so it is intended only for bounded coordination metadata. Budget reservations, rate-limit windows/permits, and leases are not yet integrated. Phase 2 is not complete and the old process-local budget behavior remains.
- No local commands were run; PR CI is the test environment under D-117.

---

## 2026-11-16 Vercel output-cap cancellation merged (PR #126)

- PR #126 merged as `4fff23a5a1c3bf6444eeb5fbe898ecd57e843d06` on top of main `54a6619e728a2c84adb950c86ba5be7ba1cae888`.
- PR-head CI run #846 passed all 10 jobs, including Ubuntu/Windows Node 20.19.0/22.12.0 verification, docs/component drift, secrets/dependencies, license inventory, architecture baseline, and `ci-pass`. Post-merge main CI run #847 is pending.
- Vercel now requests one SIGTERM through `Command.kill()` when either stdout or stderr exceeds its independent output cap, then drains until the SDK iterator settles. Fake-client tests verify the request, not live remote termination or SDK-internal buffering.
- Live Vercel S4 acceptance remains open. `COMMAND_TOOL` remains disabled. Stale draft PR #123 was closed as superseded by #126.

---

## 2026-11-16 Vercel output-cap cancellation rebased (PR #126)

- Main baseline: `54a6619e728a2c84adb950c86ba5be7ba1cae888`; post-merge CI run #840 passed all 10 jobs, including all four Ubuntu/Windows Node 20.19.0/22.12.0 verification jobs and `ci-pass`.
- Replacement PR #126 is based on this main commit. It adds a single SIGTERM request through the Vercel SDK command `kill()` when either output stream exceeds its configured cap, fake-client regression coverage, and the benchmark fake method.
- PR #126 CI is pending. Main behavior is unchanged until merge. Fake-client tests do not prove live SDK buffering or remote process-tree termination; S4 remains open and `COMMAND_TOOL` remains disabled.
- Stale draft PR #123 is superseded by #126 and should not be merged.

---

## 2026-11-16 Markdown consolidation and current main status (baseline 46e12e63)

- PR #124 merged as `46e12e6343a76e34a910de447a82a8415644bae8`. It synchronized `STATE.md`, `status.md`, `ROADMAP.md`, `BUILD-PLAN.md`, and the audit checklist; removed superseded `docs/AUDIT-CLOSEOUT.md`; and corrected manifest/recurring-audit references.
- PR #124 CI run #837 (`43868270766`) passed all 10 jobs. Post-merge main CI run #838 (`43868684870`) also passed all 10 jobs, including Ubuntu/Windows Node 20.19.0/22.12.0, documentation drift, dependency/security checks, license inventory, architecture baseline, and `ci-pass`. The acceptance-gates job explicitly does not run live acceptance.
- Main has 72 Markdown files after the first cleanup. This follow-up removes two additional redundant summaries: the obsolete root Vercel patch-status file and the duplicate owner-decision summary. Their current content is covered by the Vercel component guide, `STATE.md`, `ROADMAP.md`, and append-only `decisions.md`.
- Main source `src/bundles/sandbox-vercel/index.ts` does not expose `Command.kill()` and continues draining logs after the output cap. Draft PR #123 proposes SIGTERM at the cap but is unmerged, based on an older main SHA, and has no verified CI result for its corrected head. Live SDK buffer and remote termination behavior remain unverified.

---

## 2026-11-16 current main status (baseline 083b8cc4)

- Current main: `083b8cc4be503dade5acd32fcb5b8eda48cc2a24`. Main CI run #835 (`43758536354`) completed successfully with 10/10 jobs. CI acceptance-gates status does not constitute live Vercel/model acceptance.
- PR #113 merged retrieval collection ownership checks, owner-aware collection resets, and safer per-file replacement ordering. PR #114 made `ci-pass` require every mandatory job to succeed and expanded `npm audit` to include development dependencies.
- PRs #115-117 bounded outstanding session-log appends, semantic-memory operations, and persistent episodic writes. Session-log queue entries are released after completion and its sequence cache is capped at 256 sessions.
- PR #118 disabled host-generated-code execution, host-backed retrieval smoke, and arbitrary host command execution under D-117. `AGENTS.md` now directs repository checks to GitHub Actions and does not direct agents to use the disabled host runner.
- PR #119 added incremental bounded serialization for plain object/array tool results, with character, node, and depth limits. It avoids invoking arbitrary custom serializers for unsupported objects.
- PR #120 reconciled the audit checklist, state, roadmap, and architecture documentation with merged main.
- PR #121 added `reindexBatchSize` (default 64) and performs semantic embedding/vector upserts in batches. CI run #43757666162 measured 2,000 facts, 32 embedding requests, and 32 vector upserts (31 x 64, one x 16). p50 reindex time was 193.104 ms; p50 observed RSS delta was 1,941,504 bytes, with a 67,715,072-byte maximum across three samples. The complete fact array is still loaded and reindex is not resumable.
- PR #122 synchronized audit state after #121. The current main baseline and successful run #835 supersede the earlier in-progress CI references in this status history.
- PR-head CI passed for #113 (`43632476855`), #114 (`43632866040`), #115 (`43754058474`), #116 (`43754660989`), #117 (`43755063045`), #118 (`43755514677`), and #119 (`43756237948`). PRs #120-122 are merged. Current main CI run #835 (`43758536354`) passed all 10 jobs.
- Vercel adapter output capture on main uses the SDK async logs iterator with bounded per-stream UTF-8 buffers. It still drains after reaching the cap; draft PR #123 proposes SIGTERM at the cap. Its corrected head has no verified CI result yet, and live SDK internal-buffer/remote termination behavior remains unverified. No live Vercel execution is claimed.
- Remaining architecture work: SQLite shared transactional state; task-scoped workspace lifecycle/transfer/result synchronization; indexed episodic duplicate lookup and full-history scan reduction; durable-history paging and searchable-memory quotas; bounded indexing for large files; semantic fact-array paging/checkpoints; cross-process reservations; and the incomplete file-by-file audit.
- D-110/D-117/D-118/D-119 remain binding. `COMMAND_TOOL` remains disabled.

---

## 2026-11-14 open-item closeout pass (main baseline 74ae26a)

- Implemented bounded Vercel output collection using the SDK detached-command logs async iterator. The adapter no longer calls stdout()/stderr() methods that collect full strings. It retains at most the configured byte limit per stream, does not split UTF-8 code points, and marks truncation.
- Added fake-client tests for independent stdout/stderr limits and UTF-8 boundaries. Focused provider suite: 14 passed.
- Reran the full Linux suite: 57 files passed, 2 skipped; 1,179 tests passed, 106 skipped.
- Reran typecheck/lint, docs generation/check (73 Markdown files), secret scan, production dependency audit (0 vulnerabilities), license inventory (272 entries), and diff whitespace check. All passed.
- Reran architecture baselines on Node 22.23.5 / Linux x64 / 2 vCPUs. Session append at 100k events p50 120.151 ms / p95 125.015 ms; episode duplicate check p50 329.936 ms / p95 348.579 ms; selective query p50 183.223 ms / p95 192.947 ms. Retrieval indexing: 1,740 chunks p50 548.634 ms / p95 617.717 ms. Semantic reindex: 2,000 facts with 64-item embedding batches. Output stream fake: 8m chars per stream p50 25.761 ms / p95 38.410 ms; retained output 100,038 bytes including marker.
- Cross-process SQLite reservation acceptance is NOT complete. There is no SQLite provider/runtime on this baseline. The existing independent-process benchmark is a negative control showing oversubscription (2/4/8 processes admit 2/4/8 reservations at hard limit 1).
- Task-scoped workspace acceptance is NOT complete. Only type contracts/design rules exist; lifecycle, capability enforcement, workspace transfer, result synchronization, and crash recovery are not implemented. COMMAND_TOOL remains disabled.
- Live Vercel acceptance is NOT run. No VERCEL_TOKEN / VERCEL_TEAM_ID / VERCEL_PROJECT_ID are present in this sandbox, and its network allow-list excludes Vercel hosts. No egress consent or allow-list changes were made.
- PR #106 head 305d2e5 passed CI run #784 on Ubuntu and Windows with Node 20.19.0 and 22.12.0. The run passed typecheck, lint, full tests, architecture benchmarks, docs/component drift, secrets/dependencies, license inventory, and ci-pass. The separate Vercel deployment status failed due its deployment rate limit; it is not a test failure.
- Performance baseline documentation was reconciled to main 74ae26a and current measurements. Full file-by-file audit remains open and was excluded from this pass.

## 2026-11-14 post-PR-100 audit continuation

- PR #100 merged to main as `41ca36359b6502c986fd41924cbc6b1d643b1077`.
- Post-merge CI run #761 passed all jobs, including `ci-pass`, typecheck, lint, full tests, docs/component drift, secrets/dependencies, license inventory, architecture benchmarks, and Ubuntu/Windows on Node 20.19.0 and 22.12.0.
- Current repository inventory: 352 tracked files; 214 files under `src/`, `test/`, and `scripts/`. The complete file-by-file and cross-folder audit is still in progress.
- Reconfirmed AUD-007 and AUD-008: session-log append and episodic duplicate/query paths still scan/load full histories.
- AUD-021 and AUD-035 are fixed in main and have regression coverage. Their older open statuses in the audit register are being corrected.
- AUD-048: session-log parent symlink redirection is fixed in PR #101; its prior head passed CI run #763.
- AUD-049: compaction ledger reads/writes were vulnerable to symlink redirection through a predictable temporary filename. The updated PR #101 adds no-follow reads, parent checks, random exclusive temp files, and three regression tests; fresh CI is pending.
- No live Vercel acceptance, cloud workspace transfer, or bounded SDK streaming is claimed. D-110/D-117/D-118 remain binding.

The next audit pass continues with retrieval, embeddings/vector storage, orchestration, policy, tools, CLI, scripts, tests, and cross-folder call paths.

---

## 2026-11-14 documentation consolidation baseline

This entry is the current session status. Earlier dated entries below are retained as historical records and must not be treated as current instructions where they conflict with the latest decisions.

- The documentation consolidation baseline was main commit `81d7bf837254b8526b60aa240d6a31923647a890`. The separate codebase audit remains in progress on PR #92.
- D-117 authorizes command execution only through an explicitly selected remote cloud sandbox. D-110 still permanently holds Docker/WSL/Crabbox S0 and prohibits host execution.
- D-118 selects Vercel Sandbox as the first cloud provider. Its adapter is implemented with fake-client tests, but no project workspace transfer, result synchronization, lifecycle audit, CLI/profile registration, or live end-to-end acceptance is complete. `COMMAND_TOOL` remains disabled.
- Audit branch CI run `43516548037` passed on commit `30401b9267fbf5e2578b752f61ba802a2e1dba1c`, including Windows/Ubuntu, typecheck, lint, tests, docs drift, secret scan, dependency audit, and license inventory. A scoped override pins nested Zod to 4.6.7. Later documentation-only audit commits are being rechecked; main is unchanged until PR #92 merges.
- S4 is open as cloud-only acceptance, not passed. S6 and S7 remain open/reconciliation-required. S0 is permanently held; S1 is deferred. S5 and distribution are out of scope.
- GitHub reports branch protection disabled. Owner action remains required to protect `main` and require `ci-pass`.

The ordered next actions are in [docs/BUILD-PLAN.md](BUILD-PLAN.md). The full scope and exit criteria are in [docs/ROADMAP.md](ROADMAP.md), and the single current state table is [docs/STATE.md](STATE.md).

---
