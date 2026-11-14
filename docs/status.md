## 2026-11-14 open-item closeout pass (main baseline 74ae26a)

- Implemented bounded Vercel output collection using the SDK detached-command logs async iterator. The adapter no longer calls stdout()/stderr() methods that collect full strings. It retains at most the configured byte limit per stream, does not split UTF-8 code points, and marks truncation.
- Added fake-client tests for independent stdout/stderr limits and UTF-8 boundaries. Focused provider suite: 14 passed.
- Reran the full Linux suite: 57 files passed, 2 skipped; 1,179 tests passed, 106 skipped.
- Reran typecheck/lint, docs generation/check (73 Markdown files), secret scan, production dependency audit (0 vulnerabilities), license inventory (272 entries), and diff whitespace check. All passed.
- Reran architecture baselines on Node 22.23.5 / Linux x64 / 2 vCPUs. Session append at 100k events p50 120.151 ms / p95 125.015 ms; episode duplicate check p50 329.936 ms / p95 348.579 ms; selective query p50 183.223 ms / p95 192.947 ms. Retrieval indexing: 1,740 chunks p50 548.634 ms / p95 617.717 ms. Semantic reindex: 2,000 facts with 64-item embedding batches. Output stream fake: 8m chars per stream p50 25.761 ms / p95 38.410 ms; retained output 100,038 bytes including marker.
- Cross-process SQLite reservation acceptance is NOT complete. There is no SQLite provider/runtime on this baseline. The existing independent-process benchmark is a negative control showing oversubscription (2/4/8 processes admit 2/4/8 reservations at hard limit 1).
- Task-scoped workspace acceptance is NOT complete. Only type contracts/design rules exist; lifecycle, capability enforcement, workspace transfer, result synchronization, and crash recovery are not implemented. COMMAND_TOOL remains disabled.
- Live Vercel acceptance is NOT run. No VERCEL_TOKEN / VERCEL_TEAM_ID / VERCEL_PROJECT_ID are present in this sandbox, and its network allow-list excludes Vercel hosts. No egress consent or allow-list changes were made.
- The previous Windows Node 20/22 CI run applies to the unchanged main commit, not this new streaming diff. Windows CI for this diff remains pending.
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
