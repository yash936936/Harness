## 2026-11-09 S3 CI closeout after PR #24 merge

- PR #24 (`fix: normalize small-model edit arguments before policy`) merged into `main` as `003447221a9434303b87e8f0166a9d36916a0a6f`.
- GitHub Actions run #339 passed both `windows-latest` and `ubuntu-latest`: `npm ci`, typecheck, lint, and the full Vitest suite.
- Owner-provided Windows output independently reports 56 test files passed, 1 skipped; 1,191 tests passed, 21 skipped (1,212 total). The real sandbox test was skipped.
- The merged regressions cover edit-key normalization, strict rejection of conflicting aliases/unknown keys, package.json path-criticality hold (0.5 below 0.8), approval denial, unchanged file, and string confidence remaining untrusted.
- **Still open:** live `llama3.2:3b` acceptance after the merge. Preserve a real session JSONL showing a valid `edit_file` call, `tool.input.normalized`, `policy.decision: hold` for package.json, `approval.pending`, terminal `approval.resolved: denied`, and `.env.production` denied by `credential-path` without an approval request. Confirm `git diff -- package.json` is empty.
- S3 remains PARTIAL until that live evidence is reviewed. CI and scripted tests do not substitute for the live run. The existing S0 pause is unchanged.

## 2026-11-09 S3 edit argument normalization follow-up (DBG-093)

- Reproduced the live small-model failure: `edit_file` received camelCase `oldString` / `newString`, so strict schema validation rejected the call before policy.
- Added a fail-closed, tool-specific compatibility normalizer before strict schema validation. Original and canonical arguments are separately auditable; policy and execution receive the same canonical input.
- Added regression coverage for the package.json path-criticality hold (0.5 below 0.8), approval denial, unchanged file, ambiguous alias rejection, and string-confidence hold.
- Changes are on `fix/s3-edit-argument-normalization-2026-11-09`, based on main `c1d2be645ff34a9e2e4bd1db0a95a8dc827e776b`. CI and live Ollama acceptance are pending. S3 remains PARTIAL; do not infer acceptance from source changes.
- The `.env.production` hard-deny rule is unchanged.

## 2026-11-07 audit merge status (DBG-085)

- PR #15 merged to main as d07e191548c2fc3f6bc56192a27824af38a177d0.
- Audit branch CI run #237 passed npm ci, typecheck, lint and tests on Ubuntu and Windows. Main merge CI run #238 was still in progress at the time of this update.
- Five automated review threads resolved. S0 remains BLOCKED-HARDWARE and has not been run; S1 remains open for host-sentinel and orphan-reaper implementation/evidence.
## 2026-11-07 OpenRouter TLS enforcement (DBG-085)

**CI verified:** GitHub Actions run #247 passed on Ubuntu and Windows at `2c846ee9b9dbbef9ef9a478d17b8f02f34c98587`. Both jobs passed typecheck, lint, and tests. The OpenRouter CLI HTTPS regression is covered. This does not verify a live OpenRouter request.

- Governed OpenRouter CLI now rejects cleartext HTTP endpoints before consent or provider startup because the API key is sent in an authorization header.
- Added a regression verifying HTTP is rejected before the consent prompt. Run #247 passed on Ubuntu and Windows.

## 2026-11-07 repository-wide audit CI closeout

- Audit PR #15 was merged on 2026-11-07. Final audit head `0e9ad7a5585d73b96494d990b5be90e16dc4f036` passed GitHub Actions run #237 on both Ubuntu and Windows (typecheck, lint, and tests).
- The DBG-072 through DBG-084 code/test changes on that head are now CI-verified. This does not establish real Docker/Crabbox execution, S1 orphan reaping, live provider execution, real embedding/poisoning quality, human-labelled evaluation, distribution notices/model provenance, or desktop acceptance.
- S0 remains BLOCKED-HARDWARE. Do not infer S0 success from CI.

## 2026-11-07 egress consent store symlink hardening (DBG-084)

- FileConsentStore now fails closed on symlinked/non-regular consent files and validates file identity after open.
- Added a symlinked consent store regression on platforms that support unprivileged symlink creation. Run #247 passed on Ubuntu and Windows.

## 2026-11-07 episodic-memory read-time redaction (DBG-083)

- Episodic query and duplicate-record return paths now redact persisted records using the current egress secret registry.
- Added a legacy JSONL regression. Fresh CI required.

## 2026-11-07 provider error redaction (DBG-082)

- Provider network errors now expose only the endpoint host and a stable system error code, not URL paths or arbitrary raw fetch errors.
- Added OpenAI-compatible and Ollama regressions for path-bearing endpoint strings. Fresh CI required.

## 2026-11-07 hot-memory metadata redaction (DBG-081)

- Fixed source metadata redaction in hot memory on write and list/read, including legacy persisted records.
- Added a regression for registered secrets in source metadata. Fresh CI required.

## 2026-11-07 retrieval file-read hardening (DBG-080)

- Hardened retrieval-rank against symlink swaps between path resolution and open, and bounded reads while the file is being consumed so concurrent growth cannot exceed maxFileBytes.
- Added an outside-root symlink regression. Fresh Ubuntu/Windows CI required.

## 2026-11-07 D-109 pre-scoring gate follow-up (DBG-079)

- The calibration command now requires committed labels and refuses to print scorer output until provenance, matched IDs, sample minimum (10 or 20 when 20+ sessions are present), and both label classes pass.
- Removed the scorer-only output path and updated README usage. Root placeholder labels remain ineligible.

## 2026-11-07 evaluation provenance cross-platform follow-up (DBG-078)

- D-109 label hashing now uses Git-normalized index/commit blob bytes, avoiding false failures on Windows checkouts with core.autocrlf=true.
- The PowerShell label commit script stages the labels before computing SHA-256, then commits the sidecar and verifies the staged/committed digest.
- Added a CRLF regression. Fresh CI required.

## 2026-11-07 model budget cancellation follow-up (DBG-077)

- Fixed a budget accounting defect: cancellation while waiting for a rate-limiter slot, and a pre-dispatch request-log failure, now release reservations without charging a request.
- Provider failures after dispatch still count as request attempts. Added regression tests for queued cancellation and failed request logging.

## 2026-11-07 credential-store audit follow-up (DBG-076)

- Fixed fresh nested FileCredentialStore set/delete lock initialization by creating the data parent directory before acquiring the lock.
- Added a regression that deletes a missing key before first set, then verifies a subsequent round trip.

## 2026-11-07 semantic-memory audit follow-up (DBG-075)

- Fixed a metadata redaction gap: semantic fact source/tags are now redacted on write and when loaded, so legacy persisted metadata cannot leak through list/query.
- Added runtime input validation before tags are copied; regression tests cover secret metadata and malformed tags.
- Fresh Ubuntu/Windows CI required. Real embedding and poisoning acceptance remain open.

## 2026-11-07 documentation audit follow-up (DBG-074)

- Split S0 lease/run/release evidence from S1 host-sentinel and orphan-reaper evidence. The previous Phase 5.1 template incorrectly included an S1 requirement in S0.
- Added a complete tracked-file inventory and a Windows PowerShell 5.1 command section. Missing implementations (orphan reaper, real poisoning acceptance, desktop product) are explicitly marked as having no valid acceptance command yet.
- No S0 hardware run was performed.

## 2026-11-07 repository-wide audit follow-up (DBG-073)

- Found and fixed a remaining rate-limiter date-validation gap: constructor load now uses the same strict calendar-date validator as the locked persistent read. Added a regression for impossible past date 2026-02-31, which previously could be reset as stale state.
- CI acceptance is complete: run #247 passed on Ubuntu and Windows. No S0 hardware evidence is claimed. No S0 hardware evidence is claimed.

## 2026-11-07 — repository-wide code audit (DBG-072)

- Reviewed the 94 TypeScript source files under src/ by module and ran targeted security/reliability inspection across session logging, episodic/semantic memory, consent persistence, local file access, retrieval, model-provider configuration, evaluation, subprocess execution, sandbox adapters, orchestration, profile wiring, and CLI entry points.
- Fixed JSONL recovery for a valid final record missing its newline in session logs and episodic memory. The next append now gets a delimiter rather than corrupting the following record. Regression tests cover both valid-no-newline and torn-tail recovery.
- Fixed cross-process consent-store lost updates with a file lock and atomic rename. Added validation, defensive copies, special-key/prototype-safety handling, and concurrent-instance regression tests.
- Expanded local secret-path exclusions to cloud, SSH, CLI, Kubernetes, Docker, GCP, Cargo, Terraform, and related credential locations. Aligned retrieval exclusions and made them case-insensitive. Retrieval parsing now resolves existing result paths to reject outside-root symlinks even when ripgrep is configured to follow links.
- Added OpenAI-compatible endpoint validation for HTTP(S) only, rejecting embedded URL credentials. Added tests for invalid protocols and userinfo.
- Hardened custom evaluation scorer output validation: names, finite non-negative weights, score range, and required result types are checked before scoring.
- Snapshotted session-log payloads, episodic episodes, semantic fact metadata, and model requests at API entry to prevent mutation while queued or awaiting remote consent. Added regression tests that compare persisted/logged/sent values with the original inputs.
- Fixed the persistent rate limiter's missing parent-directory creation and tightened its persisted UTC day-key validation. The model-artifact verifier now rejects mutable revision labels and requires a full Git commit hash. Invalid model output caps are now rejected before budget reservation or provider calls, preventing negative Ollama caps from bypassing the estimate. Persisted budget state now rejects impossible and future dates instead of silently resetting; its per-process scope is documented.
- CI found and fixed a policy-gate declaration-order compile error, an unused helper under the new lint step, and test-fixture mistakes in cancellation timing and sandbox temporary-directory setup. An intermediate Ubuntu run passed typecheck, lint, and tests; the latest head still requires both-platform CI.
- These are code changes on `audit/repository-wide-review-2026-11-07`; they are not yet accepted by CI. No local compiler/test run was available through the GitHub connector. A PR and fresh Ubuntu/Windows CI run are required before merge.
- Static source inventory: 96 files. Repository inventory at audit start: 60 test files, 28 scripts, 52 desktop benchmark/app assets, and 17 documentation files. This review does not claim live Crabbox, Docker, Ollama, OpenRouter, real embeddings, or real model-quality acceptance.

## 2026-11-07 — evaluation/provenance evidence-template review (DBG-071)

- Found that tracked labels.json contains only three good labels. It does not satisfy D-109's 10+ sessions and both-class requirements, so it is not accepted as evaluation evidence.
- Corrected the evidence README to remove the superseded 20-label/90%-agreement wording.
- Corrected the Qwen provenance template to the exact Qwen2.5-Coder-7B-Instruct model selected by D-104/D-105. Immutable revision and artifact SHA-256 remain unavailable; no weights or model lock were created.
- S5 and S6 remain partial/BLOCKED-HUMAN or BLOCKED-NETWORK as detailed in the audit.

## 2026-11-07 — prototype closeout plan and live GitHub refresh (D-109, DBG-070)

- Re-read the owner-provided BUILD-PLAN.md and prompt.md; copied the plan into docs/BUILD-PLAN.md. Scope remains a working prototype.
- Live GitHub state: PR #11 (Ollama timeout) merged as fbb20018e1255ff8a1a24e24669b95b49858bbaa; PR #12 (Crabbox user-state environment) merged as e93ff1edff16b9c643eecf54ec2b3985e5829369. No open PRs were returned.
- CI run #63 for e93ff1edff16b9c643eecf54ec2b3985e5829369 passed on both ubuntu-latest and windows-latest; both jobs completed npm ci, npm run typecheck, and npm test. This is CI evidence, not a real Crabbox run.
- PR #12 forwards APPDATA, LOCALAPPDATA, XDG_STATE_HOME, and XDG_CACHE_HOME. The reported Go user-state-directory defect is fixed in code and fake-CLI tested. The build-plan's original ssh-keygen exit-255 diagnosis is not yet independently reproduced or disproved.
- S0/ARCH-01 and Phase 5.1 remain BLOCKED-HARDWARE until the owner reruns Crabbox doctor and the real Harness lease/run/release test on Windows + Docker, captures exit codes 0 and 7, confirms cleanup, and checks the host sentinel. Do not infer this from CI.
- S1 remains blocked behind S0: no host-sentinel/orphan-reaper acceptance evidence is committed.
- S3 is implemented: npm run harness -- code is present and scripted-model tested. S4 remains BLOCKED-KEY / owner acceptance for a real full task on both OpenRouter and Ollama. harness run remains a separate bare model call.
- D-109 sets the evaluation protocol to 10+ real sessions (20+ if already available), both label classes, owner-only labels hashed and committed before scorer output, no agreement-percentage gate, and a prototype-grade confusion report. No real sessions or labels are claimed.
- No local test, Docker, live-provider, real embedding, or Needle run was performed in this environment.

## 2026-11-06 — Ollama coding CLI inference timeout exposed

- Added `--timeout-ms` to the governed `code` command and passed it to `OllamaProvider.timeoutMs`. The default remains 120,000 ms when omitted; the option accepts decimal integer values from 1 through 4,294,967,295 and is rejected for OpenRouter, where this Ollama-specific setting does not apply.
- Added parser tests for omitted, valid, zero, negative, fractional, non-finite, empty, and unsafe-integer values.
- This separates the model inference timeout from the independent 120,000 ms policy approval timeout. GitHub Actions run #59 passed on Ubuntu and Windows: `npm ci`, `npm run typecheck`, and `npm test` all succeeded. No local test result is claimed.

## 2026-11-06 — Windows paused-holder acceptance passed; evaluation threshold corrected

- Owner-run Windows acceptance completed with Sysinternals PsSuspend v1.09. The dedicated PowerShell runner executed test/session-log-multiprocess.test.ts: **1 test file passed, 15 tests passed, 0 failed**, 20.66 seconds, exit code 0.
- The Windows OS-suspended live-holder regression executed and passed. This closes the previously open Windows OS-suspension evidence item. It does not claim power-loss durability or cross-filesystem stress coverage.
- Updated the audit to distinguish the verified Windows paused-holder scenario from remaining target-filesystem/platform stress.
- Corrected Phase 6.2/6.4 documentation: scripts/eval-calibrate.ts sets MIN_LABELS = 20, and validation also requires both good and bad labels and at least 90% agreement. Ten labels are insufficient. No labels or scores are fabricated.
- Crabbox, Needle, production dependency licensing, immutable model-artifact provenance, real semantic-memory quality, and the desktop product remain open or deferred pending their stated external evidence.

## 2026-11-06 — Windows lock recovery hardening (DBG-069)

- Fixed a stale-lock takeover defect: a lock with a valid live PID is no longer broken merely because its mtime exceeds `staleMs`. A dead PID is still immediately recoverable; empty/partial metadata remains age-breakable to preserve D-106 crash-during-create recovery.
- Added process-level tests for a live holder remaining exclusive beyond `staleMs`, a child crashing while holding the lock, and an aged empty lock. Added an opt-in Windows OS-suspension regression using Sysinternals PsSuspend and `scripts/test-windows-paused-lock.ps1`.
- The portable live-holder and crash regressions are committed in this branch. The actual OS-suspended Windows test has not run here; owner command: `powershell -ExecutionPolicy Bypass -File scripts/test-windows-paused-lock.ps1 -PsSuspendPath C:\\Tools\\PsSuspend64.exe` after `npm ci`. CI will run the regular tests; the PsSuspend-specific test is skipped unless the env var is set.
- Tauri/1B.4 remains open: current `app/desktop/bench/hello-tauri` is a benchmark hello-world, not a production desktop app with Node sidecar, authenticated loopback JSON-RPC, live-run/approval/replay screens. No target-machine startup or memory measurement exists. Do not mark it closed.

## 2026-11-06 — prototype audit closeout (DBG-068)

- Confirmed the governed command exists as `npm run harness -- code` in `src/cli/index.ts`; `src/cli/code.ts` boots `bootProfileCoding` with an absolute `projectRoot`, selected Ollama/OpenRouter provider, orchestrator, policy approver, gated tools and Crabbox when Docker is available. `run` remains a separate unchanged code path. Approvals print request id/tool/class/reason/input, use terminal approve/deny and are persisted through the session log's policy events.
- Confirmed no host-execution fallback: if Docker is unavailable or Crabbox doctor fails, `run_command` is removed from offered tools and the CLI prints `no sandbox: commands disabled, file tools still gated`. This is verified from source and scripted tests, not from a real Crabbox run.
- GitHub Actions run #48 for commit `8ab78294d70e6ddc798f4ace6ec468b3445df84d` completed successfully. Both `ubuntu-latest` and `windows-latest` passed `npm ci`, `npm run typecheck`, and `npm test`. This is CI evidence, not a local run. The prior status text naming run #47 was inaccurate; #48 is the confirmed run attached to the merged docs commit.
- The supplied ZIP is not a Git checkout. A local `npm ci` attempt timed out; no local lint/test counts are claimed. The CI workflow does not run `npm run lint` as a separate command; it runs typecheck plus Vitest.
- No live Docker/Crabbox, OpenRouter key/request, 10 human-labelled sessions, real Needle runtime, target-machine Windows lock stress, or installed Tauri app was available for this run. Required owner commands and evidence templates are listed in `docs/AUDIT-CLOSEOUT.md` and `docs/evidence/`.
- Found documentation drift: old entries under `docs/status.md` still describe previous phases and no longer reflect current decisions; the newest status section supersedes those historical entries. No new implementation defect was independently demonstrated in this documentation-only closeout.

## 2026-11-06 — Batch 1 governed CLI CI closeout (DBG-067)

- Fixed the optional Crabbox doctor detail access in `src/cli/code.ts`.
- Strengthened `test/code-cli.test.ts` to script an actual `read_file` tool call, assert the governed execution/logging path, and dispose Cordis contexts with `ctx.fiber.dispose()`.
- Merged PR #6 at `2b116cace5beae7ec7f5d99c24dc78fb14e9d5ef`.
- GitHub Actions run #48 (verified on the merged docs commit) completed successfully on both `ubuntu-latest` and `windows-latest`; each job passed `npm ci`, `npm run typecheck`, and `npm test`.
- This closes the Batch 1 CI repair scope only. It does not close external sandbox, model-quality, router-evaluation, or other acceptance gates listed below.

## 2026-11-06 — independent code review (D-106, DBG-066)

- Reviewed the repo against upstream crabbox docs. Fixed five defects (crabbox working directory, release confirmation, slug normalization, empty-lock wedge, deny-list gaps); tests added and shown to fail on the old code.
- A green `npm test` does not mean Docker ran: sandbox tests use fakes. Run `npm run test:real-sandbox` on a Docker machine and record the output before calling 5.1 closed.
- Open and not hidden: `harness run` is a single bare model call (no tools, gates or sandbox); no desktop UI exists beyond the benchmark apps.

## 2026-11-06 — remaining closeout work in progress

- Added a child-process crash fixture and regression test that exits after writing a partial JSONL record, then verifies the next locked append repairs the tail and preserves valid sequence order. This is a process-interruption simulation, not proof against power loss or storage-controller failure.
- Corrected the root README's stale statement that no project license had been chosen. Apache-2.0 applies to original repository work only; third-party packages and model weights remain separately licensed.
- Verified json-bignum@0.0.3's upstream MIT LICENSE despite missing npm lockfile metadata; recorded the source and release-artifact caveat (D-105). Verified the Qwen 7B Instruct model card's Apache-2.0 tag and the Qwen team's distinction between 7B and 3B; immutable model revision and artifact digest remain required before weight redistribution (D-105).
- Added DBG-064 process-interruption regression for a torn session-log tail. Its CI execution is pending; do not mark the crash-simulation gate complete until the new branch checks pass.
- External acceptance gates remain open until real evidence is captured: Crabbox/CubeSandbox execution, independently labelled real model runs, Needle comparisons, live OpenRouter call, and Tauri measurements.

## 2026-11-05 — consolidated audit closeout update (PR #1)

### Repository-local changes in this branch
- **ENG-04:** Apache-2.0 added for original repository work. `THIRD_PARTY_LICENSES.md` inventories all 180 package-lock entries. License metadata: MIT 159, Apache-2.0 14, BSD-3-Clause 2, ISC 2, Unlicense 1, 0BSD 1, undeclared 1. `json-bignum@0.0.3` requires verification and a release-specific bundle review remains before redistribution.
- **ENG-08:** the logged allowlist decision is exact-model scoped. Qwen2.5-Coder-7B-Instruct only with verified immutable revision and artifact digest; Qwen2.5-Coder-3B-Instruct is excluded from commercial distribution absent separate written permission. No model weights are redistributed by this PR.
- **Session log:** append repairs a malformed final tail under the per-session lock before calculating the next sequence; a restart/append test covers the repair path. Earlier corruption is still rejected.
- **BUG-12:** `search_semantic_memory` is registered only when embeddings and vector store are configured. It is read-only, caps hit count and text, requires a non-empty source for model-visible facts, passes the requesting actor through an explicit semantic grant check, and uses the common input-guard post-execute fence. Sub-agent semantic access defaults off and requires `memory: { semantic: true }` in the sub-agent grant.
- **ARCH-02:** router remains safely unowned by default. The new implementation does not pretend Needle has won; no real Needle comparison was available.
- **File locking:** source retains fail-closed exclusive lock acquisition and token-checked release. Cross-platform stress and paused-holder evidence remain incomplete.

### Acceptance checklist
| Item | State | Closure evidence or remaining gate |
|---|---|---|
| ARCH-01 sandbox-only `run_command` | OPEN | `LocalTools` routes commands and Git-config probes through `ctx.sandbox` only; no provider is configured by default. Crabbox doctor and a real lease/run/release must pass on target Windows/Docker before sandbox execution can be marked verified. |
| ENG-04 Apache-2.0 + notices | PARTIAL | Project license and 180-entry lockfile metadata inventory added. Verify `json-bignum@0.0.3` license and the exact packaged dependency set before redistribution. |
| ENG-08 Qwen | DECIDED | Exact 7B Instruct allowlist only after immutable revision/hash verification; 3B excluded absent written commercial permission. |
| Phase 6.2, 20 real labels | OPEN | Needs 20+ real model-driven sessions, independently labelled before inspecting scores; none fabricated. |
| Phase 6.4 real-data evaluation | OPEN | Needs evaluation on that committed real-label dataset and human agreement record. |
| ARCH-02 Needle shadow/evaluation | OPEN | Needs real Needle wrapper/runtime and frozen-suite + real-task shadow evidence. |
| ARCH-02 router ownership | COMPLETE SAFE DEFAULT | `router.owned` stays empty for unmeasured classes. |
| Session-log torn-write recovery | IMPLEMENTED, CI PENDING | Under-lock repair + restart/append regression committed; CI will validate TypeScript and test behavior. |
| File-lock safety | PARTIAL | Advisory locks and multiprocess tests exist; paused-live-holder and target filesystem/platform stress still need actual Windows/Linux runs. |
| BUG-12 semantic retrieval | IMPLEMENTED, CI PENDING | Agent tool is bounded, source-attributed, read-only, actor-granted, and fenced by input-guard; new tests cover grant enforcement and wired path. Real-model retrieval quality/poisoning acceptance still needs real-model evidence. |
| OpenRouter live provider | OPEN | Requires owner key/model and consumes provider quota; no live request was made. |
| Tauri sidecar decision | OPEN | Existing benchmark harness is present; real builds, install size, cold start and idle-memory-with-core measurements remain unavailable. Prior D-048 provisional Tauri choice is not evidence-complete and is superseded by this explicit hold. |
| 1B.4 remaining implementation | PARTIAL | The terminal setup wizard exists, but is setup-only and does not start a harness task. Desktop shell screens and core/sidecar integration remain unbuilt. |

### Validation
The initial CI run on this branch failed in `npm run typecheck` because the semantic tool integration test referenced a removed test-local embedding provider. That declaration was restored and duplicated assertions were removed in the next commits. A fresh CI run is pending for the latest head; do not merge until both OS jobs pass. Connector inspection is not a substitute for running the test suite. The external acceptance gates above cannot be closed from this environment because no target Windows/Docker host, real Needle runtime, real sessions, live provider credential, or 8 GB benchmark machine was available.
# Status — Coding Harness

> Updated every run. Newest entry at top.

## 2026-11-03 — audit list complete except owner decisions (D-100..D-103, DBG-062)
**Done since last entry:** ARCH-02, BUG-12, BUG-07, BUG-09, ENG-03, ENG-05, ENG-07.
**Still open:** your decisions: ARCH-01 (route `run_command` through the sandbox; Crabbox still failing its doctor, D-093), ENG-04 licence, ENG-08 Qwen. Real-data work: label 20+ real agent runs for 6.2/6.4; run `router.shadowTool` on real tasks to collect Needle-vs-worker agreement (needs a real Needle).
**Known weak spot, unfixed:** a crash mid-write can leave a torn last line in a session log that a later append then buries mid-file (D-102).

## 2026-11-02 — ARCH-03 done (D-099, DBG-061)
**Done:** budgets and a shared rate limiter are enforced at `ctx.llm.complete` for every agent; `profile-coding` meters by default.
**Still open from the audit:** ARCH-02 (router not consulted), BUG-12 (semantic memory in the coding profile), BUG-07/09 (cross-process log and memory locking), ENG-03/05/07, ARCH-01 (owner decision), ENG-04 licence, ENG-08 Qwen blocker.
**Next up:** ARCH-02, then BUG-12, then BUG-07/09. Close Phase 6.2/6.4 by labelling real runs (`npm run eval`).

## 2026-11-02 — audit fixes and Phase 6 built (D-094..D-098, DBG-060)
**Done:** SEC-01..04, BUG-01..06, BUG-08, BUG-10, BUG-11, ARCH-04, ENG-02 (CI workflow, ubuntu + windows, untested until pushed), Phase 6.1/6.2 with 6.4 partially (scripted-model, see D-098).
**Not done from the audit:** BUG-07 and BUG-09 (cross-process log and memory locking), BUG-12 (semantic memory in the coding profile), ARCH-01 (sandbox wiring: owner decision, see below), ARCH-02 (router not consulted), ARCH-03 (budgets not enforced at the model-call boundary), ENG-01/03/04/05/07/08.
**Owner decisions needed:** (1) ARCH-01: `run_command` still runs on the host; crabbox is not installed (DBG-058) so routing through it now would leave runs unable to execute. (2) Licence (ENG-04). (3) Label 20+ real runs with `scripts/eval-calibrate.ts` to close 6.2/6.4.
**Next up:** run the suite on Windows; then ARCH-03, ARCH-02, BUG-12, BUG-07/09.

## 2026-10-11 — Crabbox installed; first real router numbers (D-092, D-093, DBG-059)
Verified on Windows: 916 passed / 7 skipped (44 files); Crabbox 0.73.0 installed; WSL rsync/ssh at Linux paths. NOT verified: 5.1 lease/run/release (provider doctor fails, reason hidden by my bug, now fixed), Needle, 7B routing, items 6 and 7.
**Owner to run next (Git Bash, repo root):** (1) `crabbox doctor --provider local-container --local-container-runtime docker` and paste ALL of it; (2) after applying this zip, `HARNESS_CRABBOX_RUNTIME=docker npx tsx scripts/smoke-crabbox.ts` (now prints the failing checks); (3) item 6: `HARNESS_TRIALS=3 npx tsx scripts/smoke-orchestrate.ts`; (4) optional: `HARNESS_ROUTER_WORKER=qwen2.5-coder:7b-instruct npx tsx scripts/eval-router.ts`.
**Decision for the owner:** whether to enable `router.owned: ['agent']` without Needle (rules then worker). I recommend not yet (D-092).

## 2026-10-10 (owner run) — what the pasted output shows
Verified on Windows: the sandbox build (896 passed / 7 skipped, 43 files) and the `smoke-orchestrate.ts` self-tests. NOT verified: 5.1 (crabbox is not installed: ENOENT) and everything needing a real model or Needle. See DBG-058. Phase 5 and 4.5 remain built-not-closed.
**Router build verified on Windows (915 passed / 7 skipped, 44 files).** **Next for the owner:** install Crabbox (on Windows, there is no brew: run `scripts/install-crabbox-windows.ps1` (the official installer, verbatim) in PowerShell, then `HARNESS_CRABBOX_RUNTIME=docker npx tsx scripts/smoke-crabbox.ts` from the repo root; it needs native Git, the OpenSSH client, curl, and rsync from WSL2 Ubuntu (preferred) or MSYS2, plus Docker, which is running; Crabbox v0.42.1 or newer) and rerun `smoke-crabbox.ts`; run item 6 (D-089).

## 2026-10-10 (latest) — 4.5 router built (D-091, DBG-057)
4.5 is **built, not closed**: no real Needle has been run, so no class has earned ownership (criterion 2). `router.owned` is empty by default, so behaviour is unchanged. The router is not yet consulted by the orchestrator or agent loop.
**Owner to run:** `npx tsx scripts/eval-router.ts` (rules vs the worker; needs Ollama). With a Needle wrapper you supply (stdio JSON contract in `src/bundles/router/backends.ts`): `HARNESS_ROUTER_CMD="..." HARNESS_ROUTER_FILES="path/to/needle2.cact" npx tsx scripts/eval-router.ts`. A class goes into `router.owned` only on an `OWNS` line for a Needle row.
**Test counts to expect on your machine:** 879 passed / 7 skipped before; 36 new tests (17 sandbox, 19 router) -> 915 passed / 7 skipped, 44 files.
**Needs your decision:** (a) who supplies the Needle wrapper (I did not write one: the Cactus runtime's interface is unverified); (b) whether the router should be wired into the orchestrator next.
**Next:** run item 6 (D-089), record numbers as D-092, then Phase 6.

## 2026-10-10 (later) — 5.1 and 5.2 built (D-090, DBG-056)
Phase 5 is **built but not verified end to end**: 5.1 and 5.2 pass against fakes only. It should not be called closed until `scripts/smoke-crabbox.ts` passes on a machine with crabbox + Docker (5.1) and `scripts/smoke-cubesandbox.ts` passes on an x86_64 Linux KVM host (5.2; D-024 had deferred this to Phase 8).
**Owner to run, paste output whole:** `npx tsx scripts/smoke-crabbox.ts` (needs `crabbox` on PATH, Docker running; on Windows also rsync, and a failing `doctor` is itself the D-024 finding). The cube script needs a KVM host and `npm i e2b`.
**Test counts to expect on your machine:** previous 879 passed / 7 skipped; with 17 new tests, see the latest entry above.
**Not done:** `run_command` still runs on the host and is still `real-fs-write` (D-080); routing it through `ctx.sandbox` is a decision for you.
**Next:** run item 6 (D-089), record numbers as D-092, then Phase 6.

## 2026-10-10 — item 6 measurement prepared (D-089, DBG-055)
Built `scripts/smoke-orchestrate.ts` (no `src/` change). Item 6 (which model plans) is NOT closed: nothing has been run against a real model yet.
**Owner to run (Git Bash), then paste each output whole:** (1) `HARNESS_TRIALS=3 npx tsx scripts/smoke-orchestrate.ts` (3B alone, 7B alone, 7B plans / 3B works, single 7B; slow on CPU), (2) the same with `HARNESS_ON_FAILURE=continue HARNESS_RETRIES=1` to exercise D-074 on real failures. Then `npm test` is unchanged (expect 879 passed / 7 skipped, 42 files).
**Open-item register:** 6 open (run above) | 7a open (run 2 above) | 7b partly closed (single-agent measured, orchestrated not) | 7c open (hot rule: run `smoke-real-model.ts` on the 7B) | 8 Phase 6 | 9 Tauri / 1B.4 not started | 10 Qwen license (D-049) open, blocker for commercial release. Owner decision still pending: approval volume (D-088).
**Next:** record the numbers (D-091), decide who plans, then 4.5 router, 5.1, 5.2, Phase 6.


## 2026-10-09 (night) — 7B run recorded; JSON Lines tool-call recovery (D-088)
qwen2.5-coder:7b-instruct: 8/9 correct, 0 failed tool calls, ~33 min for 9 trials. Its one miss exposed a gap in text tool-call recovery (two JSON calls on separate lines); fixed, tested, mutation-checked. Linux 788 passed / 98 skipped. f1bd604 pushed earlier (D-087).
**Owner to run (Git Bash):** apply the zip, `npm install`, `npm run typecheck`, `npm test` (expect 879 passed / 7 skipped, 42 files), commit, push.
**Open decision for you:** approval volume (D-088). My recommendation: keep fail-closed, no change now; later add session-scoped approval in the app's approver.
**Next:** item 6 (which model plans) using the orchestrator path on the 3B and 7B models, then item 7, then 4.5 router, 5.1, 5.2, Phase 6.

## 2026-10-09 (later) — third real-model run recorded (D-087)
b997460 pushed (873 passed / 7 skipped on Windows). llama reads work now (0 failures, `read` 3/3 valid). Remaining failures are model content (invented `old_string`, double-escaped output, no edit attempted); correctness is within run-to-run noise (qwen fix 1/3, 2/3, 0/3 across runs). Stopped adding tool leniency on purpose.
**Next measurement (my pick, you can veto):** same script on a 7B-class coder, then more trials on whichever model is better. Commands in the reply. Then item 6 (orchestrator path), 7, then 4.5 router, 5.1, 5.2, Phase 6.

## 2026-10-09 — second real-model run analysed; four harness fixes (D-086)
Run at 5189bd6 (Windows 862 passed / 7 skipped, pushed). Causes found: llama sends the string "null" for optional line numbers and then edits blind; qwen collapses multi-line text and can dead-end on an empty file; self-reported confidence did not discriminate (qwen 1/7 ok when it reported one). Fixed: "null" strings, lenient confidence reaching the gate (still held), whitespace-insensitive unique edit match, empty-file fill. Linux 782 passed / 98 skipped.
**Owner to run (Git Bash):** apply the zip, `npm install`, `npm run typecheck`, `npm test` (expect 873 passed / 7 skipped, 42 files), then re-run the model script and paste the whole output; commit and push.
**Next:** if llama's reads now succeed and qwen's edits match, record the new numbers (D-087); then items 6 and 7; then 4.5 router, 5.1, 5.2, Phase 6.

## 2026-10-08 (night) — item 5 first results recorded (D-085)
Real-model run: llama3.2:3b fix 0/3, create 0/3; qwen2.5-coder:3b fix 1/3, create 2/3; 3B models are weak tool drivers; confidence did not discriminate (qwen: >= 5 of 9 failed writes reported >= 0.9); gate and tools behaved; 0 input-guard flags. `read` task was invalid (guessable answer), fixed. `read_file` now tolerates junk optional fields. Linux 771 passed / 98 skipped. Pushed before this step: 51bd805.
**Owner to run (Git Bash):** apply the zip, `npm install`, `npm run typecheck`, `npm test` (expect 862 passed / 7 skipped, 42 files), then re-run the model script and paste the whole output.
**Next:** act on the new diagnostics; then items 6 and 7; then 4.5 router, 5.1, 5.2, Phase 6.

## 2026-10-08 (evening) — item 5 prepared: real-model run on `profile-coding` (D-084)
Windows run of D-083: 861 passed / 7 skipped, 42 files, pushed as 60d4b5d. `scripts/smoke-coding.ts` is ready (self-tested with a stand-in and a do-nothing negative control; not yet run against a model). Models chosen by me: llama3.2:3b and qwen2.5-coder:3b-instruct.
**Owner to run (Git Bash), then paste the whole output:** `HARNESS_CODING_MODELS=llama3.2:3b,qwen2.5-coder:3b-instruct HARNESS_TRIALS=3 npx tsx scripts/smoke-coding.ts` (needs Ollama serving; takes a while on CPU).
**Next:** record the numbers (D-085), fix what they show (invalid `edit_file` input, no `confidence`, wrong results), then items 6 and 7 from the same run, then 4.5 router, 5.1, 5.2, Phase 6.

## 2026-10-08 (later) — open items 2, 3, 4 closed in code (D-083, DBG-054)
Done: stale known-gaps line corrected (`profile-coding` wires memory, subagents, skills-when-named); `input-guard` fences and flags every tool result (heuristic, not prevention); lessons are now derived by template from harness facts and promoted through existing compaction. Linux 770 passed / 98 skipped.
**Owner to run (Git Bash):** extract the new zip over the repo, `npm install`, `npm run typecheck`, `npm test` (expect 861 passed / 7 skipped, 42 files), commit, push.
**Open-item register now:** 1 done (D-082) | 2 done | 3 done in code, real-model respect unmeasured | 4 done | 5 first real-model run on `profile-coding` (NEXT, needs the owner's Ollama) | 6 which model plans | 7 never measured: real failures (D-074), answer correctness, hot-rule following | 8 benchmark stays in Phase 6 (agreed) | 9 Tauri/1B.4 | 10 Qwen license (D-049). Then 4.5 router, 5.1, 5.2, Phase 6.

## 2026-10-08 — Windows-verified 5.6 and real tools; one bug found and fixed (D-082, DBG-053)
Owner run: 814 passed / 7 skipped, commit 7719e84 pushed. `run_command` works on Windows for `node`, `git` and `npm` (my "npm will fail" prediction was wrong). `npm.cmd` exposed a real bug in `ctx.subprocess` (use before declaration on a synchronous spawn failure); fixed with a regression test. Linux: typecheck clean, subprocess tests 19/19.
**Owner to run (Git Bash):** extract the new zip over the repo, `npm install`, `npm run typecheck`, `npm test` (expect 815 passed / 7 skipped, 40 files), commit, push.
**Plan set by owner:** close ALL remaining open items, then Phase 4 router (4.5, Needle), then 5.1 (sandbox), then Phase 6. Open-item register below in this entry's next step (see the reply that produced it); to be copied here once the owner confirms the order.

## 2026-10-07 (later) — 5.6 built: `profile-coding` + guardrail integration test (D-081, DBG-052)
`bootProfileCoding` boots the full coding stack (scope before gate; real tools; `commandRisk` always wired; threshold floor 0.5) and **refuses to boot with the gates off, or if `verifyGates` cannot prove they enforce** (a probe `rm -rf /` must be blocked, a shell command held). One scripted run hits all five classes and an independent log audit finds nothing. 38 tests, Linux 723 passed / 98 skipped.
**Owner to run (Git Bash):** extract the new zip over the repo, `npm install`, `npm run typecheck`, `npm test` (expect 814 passed / 7 skipped, 40 files), commit and push. Also still wanted from the last step: output of `run_command` with `node --version`, `git status`, `npm test` on Windows.
**Decision for you:** the 0.5 floor on `confidenceThreshold` is my choice (D-081).
**Phase 5 is NOT fully closed:** 5.1/5.2 (real sandboxes) are unbuilt, so no real tool is sandbox-write or external-side-effect yet.
**Next up:** a first real-model run on `profile-coding` (does a 3B model produce a valid `edit_file`, and a `confidence`?); then decide between 5.1 (sandbox), the Phase 4 router, or Phase 6 (evals).

## 2026-10-07 — real tools built (D-080, DBG-051)
`bundle-tools-local`: `read_file`, `edit_file`, `write_file`, `run_command` over the real filesystem and `ctx.subprocess`, registered real-fs-write (read_file read-only). The gates now guard real tools. 40 tests, 15 mutations (14 caught, 1 equivalent). Linux 685 passed / 98 skipped.
**Owner to run (Git Bash):** extract the new zip over the repo, `npm install`, `npm run typecheck`, `npm test` (expect 776 passed / 7 skipped, 39 files; a few more skipped if symlinks cannot be created), then commit and push.
**Found:** a command call would have scored 1.0 on the path and size signals and auto-run at confidence 0.9. Fixed by design (no path-like fields, so no signal means HOLD) plus the `commandRisk` signal, which the profile MUST pass to the gate.
**Likely problem on Windows (unverified):** `run_command {command:'npm'}` probably cannot start (`.cmd` with no shell). Please try `node --version` and `git status` (should work) and `npm test` (probably fails) and paste the output.
**Next up:** 5.6 with `profile-coding` (wires tools-local, policy-gates with `commandRisk`, subagent-scope ordering; refuses to boot with the gates off). Then a first real-model run with these tools (does a 3B model produce a valid `edit_file`, and any `confidence`?).

## 2026-10-06 (later) — Phase 5.3-5.5 policy gates built (D-079, DBG-050); two more real runs recorded (D-078)
`ctx.policy`: deny-list, external-side-effect always held, confidence-scored real-fs-write with approvals, sandbox/read-only logged. 44 tests, 24 mutations caught. Linux 645 passed / 98 skipped.
**Owner to run (Git Bash):** extract `Harness-phase5.zip`, `npm install`, `npm run typecheck`, `npm test` (expect 736 passed / 7 skipped, 38 files), then commit and push.
**Found:** the repo registers only read-only tools, so the gate currently guards tools that do not exist yet. The deny-list does not catch encoded or indirect commands.
**Next up:** 5.6 integration test (all five classes in one run; `profile-coding` must refuse to boot with the gates off). That needs a `profile-coding` file, which does not exist yet.
Beyond 5.6, the real gap is that there are no actual write or shell tools: building a file-edit tool and a shell tool (over `ctx.subprocess`), registered with the right classes, would make the gates guard something real. 5.1 (crabbox) is amended and needs measurements first; 5.2 is deferred to Phase 8.

## 2026-10-06 — phases 4.1-4.4 closed; real-model results in (D-077, DBG-049)
Windows 690 passed / 7 skipped (37 files). Planner n=15: constrained 29/30 first-try valid vs 20/30 unconstrained (p=0.006 pooled); 30/30 vs 28/30 after repair. First real executor run: 11 of 12 plans executed to completion, 0 failed subtasks of 30.
Not shown: answer correctness, plan quality, any real failure through the D-074 policy, qwen as a worker. Added array-size limits to the plan schema (unverified on the owner's Ollama).
**Owner to do:** extract `Harness-phase4.5prep.zip`, `npm install`, `npm run typecheck`, `npm test` (expect 692 passed / 7 skipped, 37 files); then COMMIT 4.4 and this (4.4's test and docs were not in commit 8492894).
Optional measurements, each cheap: (a) `HARNESS_TRIALS=5 HARNESS_OLLAMA_CHAT_MODEL=llama3.2:3b,qwen2.5-coder:3b-instruct npx tsx scripts/smoke-plan.ts` to confirm the size limits do not break the schema on this Ollama; (b) the split config (qwen plans, llama works).
**Next up:** Phase 5 (policy gates) is my recommendation; planners already request write tools, and a `real-fs-write` grant is held back only by the ceiling. 4.5 (router) stays optional and has its own prerequisites.

## 2026-10-05 (end) — 4.4 end-to-end test done (D-076, DBG-048)
11 tests, no `src/` change. Linux 599 passed / 98 skipped. **Owner to run (Git Bash):** `npm install`, `npm run typecheck`, `npm test` (expect 690 passed / 7 skipped, 37 files).
Phases 4.1-4.4 are done against scripted models. Still owed by the owner, and needed to call 4.1/4.2 measured rather than just built: the `scripts/smoke-plan.ts` comparison (D-072) and a first `scripts/smoke-execute.ts` run (D-075).
**Next up:** 4.5 router (Needle), which is optional and has its own prerequisites (pinned model in the model store 1B.3, a frozen router suite). Or Phase 5 (policy gates), which is what actually makes a `real-fs-write` grant safe.
Open: whether to do 4.5 before Phase 5.

## 2026-10-05 (night) — 4.2 executor built (D-075, DBG-047)
Executor implements the D-074 policy; 25 tests, 22 mutations caught; Linux 588 passed / 98 skipped.
**Owner to run (Git Bash):** `npm install`, `npm run typecheck`, `npm test` (expect 679 passed / 7 skipped, 36 files). Then, with Ollama serving, the first real end-to-end run:
`HARNESS_TRIALS=3 HARNESS_OLLAMA_CHAT_MODEL=llama3.2:3b npx tsx scripts/smoke-execute.ts` (planner and worker are the same model; split them with HARNESS_PLANNER_MODEL / HARNESS_WORKER_MODEL). Paste it whole.
Still pending from before: the constrained-vs-unconstrained `scripts/smoke-plan.ts` comparison (D-072). It decides which model PLANS; it does not block 4.4.
**Next up:** 4.4 end-to-end test (scripted, a plan across at least two scoped sub-agents, each confined to its own scope, all visible in the log), then 4.5 router if wanted.

## 2026-10-05 (later) — 4.3b memory scoping built (D-073); executor failure policy decided (D-074)
Memory is scoped per sub-agent (access grants, scoped hot rules, per-agent episodes, per-agent compaction); a real cross-agent compaction leak was found and closed.
Linux 563 passed / 98 skipped. **Owner to run (Git Bash):** `npm install`, `npm run typecheck`, `npm test` (expect 654 passed / 7 skipped, 35 files).
**Still waiting on the owner:** the constrained-vs-unconstrained `scripts/smoke-plan.ts` comparison (see the entry below). 4.2 depends on it; nothing else does.
**Next up:** 4.2 executor with the D-074 policy, once the comparison is in. Then 4.4.

## 2026-10-05 — planner reality check; structured output added (D-072, DBG-045)
smoke-plan unconstrained: llama 6/9 valid, qwen 7/9 (n=9, cannot rank). Constrained decoding built and unit-tested; effect on real models UNMEASURED.
**Owner to run (Git Bash):** `npm install`, `npm run typecheck`, `npm test` (expect 633 passed / 7 skipped, 34 files), then BOTH:
`HARNESS_TRIALS=5 HARNESS_STRUCTURED=0 HARNESS_OLLAMA_CHAT_MODEL=llama3.2:3b,qwen2.5-coder:3b-instruct npx tsx scripts/smoke-plan.ts` (baseline, n=15) and the same
without `HARNESS_STRUCTURED=0`. Paste both whole.
**Next up:** 4.2 executor only after that comparison. If structured output lifts validity near 100% the executor can assume plans; if not, the planner needs a stronger model.
Open: memory scoping (blocks 4.3's last criterion and 4.4); executor failure policy (lean: abort by default).

## 2026-10-04 (night) — 4.1 planner built (D-071, DBG-044)
4.3 verified on Windows (614 passed / 7 skipped). 4.1: `ctx.orchestrator.plan()`; 13 tests, 14 mutations caught; Linux 536 passed / 98 skipped.
**Owner to run (Git Bash):** `npm install`, `npm run typecheck`, `npm test` (expect 627 passed / 7 skipped, 34 files), THEN the check that matters:
`HARNESS_TRIALS=3 HARNESS_OLLAMA_CHAT_MODEL=llama3.2:3b,qwen2.5-coder:3b-instruct npx tsx scripts/smoke-plan.ts` and paste the whole output.
**Next up:** 4.2 executor, ideally after seeing that output: if neither 3B model can produce a valid plan, the planner needs a stronger model
(an OpenRouter free model for planning only) and that changes 4.2's assumptions. Still open: memory scoping (blocks 4.3's last criterion and 4.4);
I proceeded because 4.1 does not depend on it. Also open: executor failure policy (retry / abort / skip: which default?).

## 2026-10-04 (end of day) — real-model reruns in; Phase 4 started with 4.3 (D-068, D-069, D-070, DBG-043)
Owner's Windows run of the 3.6+recovery tree: 599 passed / 7 skipped (as predicted). Real-model run 2 (D-070): `tools` capability IS listed
for qwen2.5-coder:3b, so the hypothesis failed; it still writes calls as text (38/38 recovered). llama3.2:3b used the native channel and
passed the single-lookup case 3/3. Neither followed a hot rule; load_skill use 1/3 each. n=3, so counts not rates.
**Found a bug while starting Phase 4:** the loop ran tools the model was not offered. Fixed (D-068).
**Built:** 4.3 `subagent-scope` (D-069), tools only. 15 tests, 8 mutations caught. Linux 523 passed / 98 skipped.
**Verified on Windows:** 614 passed / 7 skipped, 33 files, typecheck clean; D-068 mutation reproduced by the owner (3 fail, restored 15/15).
**Next up:** 4.1 planner. Design constraint from D-070: workers are weak, so the plan is a schema-validated list of narrow subtasks and an
invalid plan is rejected, not executed. Open owner decisions: (a) memory scoping: add a scope key to memory, or declare memory shared in v1
(blocks 4.3's last criterion and 4.4)? (b) which model plans: the same 3B worker, or a stronger one (an OpenRouter free model) for planning only?

## 2026-10-04 (late night) — 3.6 verified on Windows; FIRST REAL-MODEL RUN FOUND A FAILURE; recovery built (D-067, DBG-042)
3.6 verified: 586 passed / 7 skipped. Real-model run 1 (qwen2.5-coder:3b-instruct): NO tool call ran in any trial; the model wrote
calls as text, so the loop treated them as answers. Memory and skills results are therefore uninformative for this model so far.
Built opt-in `textToolCalls` recovery for the Ollama provider (strict, all-or-nothing, logged). Linux sandbox 508 passed / 98 skipped.
**Owner to run (Git Bash):**
1. `npm install`, `npm run typecheck`, `npm test` (expect 599 passed / 7 skipped, 32 test files including the new `ollama-text-tool-calls.test.ts`)
2. `ollama show qwen2.5-coder:3b-instruct` and paste it (is "tools" listed under Capabilities? it tests the hypothesis)
3. `HARNESS_TEXT_TOOL_CALLS=1 HARNESS_TRIALS=3 HARNESS_OLLAMA_CHAT_MODEL=qwen2.5-coder:3b-instruct npx tsx scripts/smoke-real-model.ts`
4. the same without `HARNESS_TEXT_TOOL_CALLS` for `llama3.2:3b` (it may use the tool channel natively): `HARNESS_TRIALS=3 HARNESS_OLLAMA_CHAT_MODEL=llama3.2:3b npx tsx scripts/smoke-real-model.ts`
**Decision waiting on the output:** which model is the reference worker (D-030 assumed qwen2.5-coder:3b; that assumption failed its
first test). Phase 4 should not start until some model has been seen to call tools and use memory/skills.

## 2026-10-04 (night) — real-model script ready; 3.6 still unverified on Windows (DBG-041)
The owner's latest `npm test` output was the 3.5 tree (577 passed, 30 files, no `memory-integration.test.ts`), so 3.6 is NOT
verified there yet: re-extract `Harness-phase3.6.zip` (it now also contains the real-model script) and rerun; expect 586 passed / 7 skipped, 31 files.
`ollama list` shows: nomic-embed-text, qwen2.5-coder:3b-instruct (D-030 reference worker), llama3.2:3b.
**Owner to run (Git Bash), in this order:**
1. `HARNESS_TRIALS=3 HARNESS_OLLAMA_CHAT_MODEL=qwen2.5-coder:3b-instruct npx tsx scripts/smoke-real-model.ts` (quick first look; the first trial includes model load time)
2. if that works, the fuller run: `HARNESS_OLLAMA_CHAT_MODEL=qwen2.5-coder:3b-instruct,llama3.2:3b npx tsx scripts/smoke-real-model.ts` (n=5 each; allow a long time on CPU)
Paste the whole output. `ollama serve` must be running.
**Next up:** decide Phase 4 vs fixing what the real run exposes, once the output is in. Do not start Phase 4 on the assumption that a 3B model drives the loop well.

## 2026-10-04 (later) — 3.5 verified on Windows; 3.6 built; PHASE 3 BUILT (D-066, DBG-040)
3.5 confirmed on the owner's Windows run: 577 passed / 7 skipped, as predicted.
3.6: two-session integration test with a stand-in model, 4 controls, poisoning demo. Plumbing only (D-066). Added a missing
crash-recovery test for compaction (found by a surviving mutation). Readme rewritten to match reality. Linux sandbox 495
passed / 98 skipped.
**Owner to run (Git Bash):** `npm install`, `npm run typecheck`, `npm test`; expect 586 passed / 7 skipped.
**Phase 3 summary:** 3.1-3.6 built; 3.1-3.5 verified on Windows; 3.3 also on a real embedding model. NOT shown: that a real
chat model changes behaviour because of memory or calls `load_skill`; nothing writes lessons; compaction/skills are
prompt-poisoning surfaces with partial mitigation; no profile wires memory or skills (profile-coding is Phase 5's finish line).
**Next up:** Phase 4 (orchestrator + sub-agents) or, first, closing the gaps above. My recommendation: before Phase 4, run a
real chat model through the loop once (`HARNESS_OLLAMA_CHAT_MODEL`): it is the largest unverified claim in the whole project
(Phases 1-3 have never had a real model drive the loop), and Phase 4 multiplies whatever is wrong with it. Open questions for
the owner: (a) which chat model is installed (`ollama list`)? (b) do you want that real-model run before Phase 4, or Phase 4 first?

## 2026-10-04 — 3.4 verified on Windows; 3.5 skills bundle built (D-065, DBG-039)
3.4 confirmed on the owner's Windows run: 546 passed / 7 skipped, as predicted.
3.5: `ctx.skills` per the real Agent Skills spec: index (level 1), `load_skill` (level 2), `read_skill_resource` (level 3),
spec validation with reported problems, restricted YAML reader, confined read-only resource access, optional
host-side `autoLoad` with keyword and embedding matchers. 31 new tests, 21 mutations all caught. Linux sandbox 486 passed / 98 skipped.
**Owner to run (Git Bash):** `npm install`, `npm run typecheck`, `npm test`; expect 577 passed / 7 skipped.
**Not verified (needs a real model):** does a real chat model call `load_skill` unprompted (needs `HARNESS_OLLAMA_CHAT_MODEL`,
open since Phase 2), and does `embeddingMatcher` behave on a real embedding model. Unit tests use scripted stand-ins.
**Next up:** 3.6 memory-system integration test: "prove memory improves outcomes across sessions, not just accumulates".
Open design questions for the owner: (a) what is the measurable outcome? With a scripted model, "improved" can only mean
the right context reached the model, which is plumbing, not improvement. A real chat model on a fixed task set, with and
without memory, is the honest test but needs HARNESS_OLLAMA_CHAT_MODEL and costs time; (b) lessons: something must write
them (D-064). I lean: build the scripted-model plumbing test now (fact stored in session 1 reaches session 2 and changes
the answer) and clearly label it as plumbing; defer the real-model before/after to Phase 6.

## 2026-10-03 (late) — 3.3 closed; 3.4 compaction built (D-064, DBG-038)
3.3: owner's rerun confirmed `free-tier` outranked `retry` (ambiguous query); all real-model checks pass.
3.4: `ctx.memory.compact()` (+ optional `compaction.everyTurns`), exact-normalised lesson matching, ledger so removed rules
stay removed, promoted rules at priority -1, `dryRun`/`approve`. 16 new tests, 12 mutations all caught. Linux sandbox
455 passed / 98 skipped.
**Owner to run (Git Bash):** `npm install`, `npm run typecheck`, `npm test`; expect 546 passed / 7 skipped.
**Honest limits:** (1) nothing writes lessons yet, so compaction is inert in real use until a lesson source exists;
(2) auto-promotion into every system prompt is a poisoning path (D-064) with only partial mitigation; (3) no `ctx.jobs`
and no wall-clock schedule; (4) hot tier only, procedural comes with 3.5.
**Next up:** 3.5 skills bundle (Agent Skills spec: SKILL.md, progressive disclosure). Open design questions for the owner:
(a) where do skill folders live (a project `skills/` dir, a user-level dir, or both)? (b) what makes "the task matches a
skill's description": embedding similarity (reuses `ctx.embeddings`, needs a minScore, and I have one measured data point
for nomic: ~0.48) or simple keyword matching first? I lean embeddings with an explicit threshold plus an exact-name override.

## 2026-10-03 (night) — 3.3 verified against a real model, with one caveat (DBG-037)
Owner's Ollama run: 6/6 facts found, 5/6 first (one ambiguous miss at rank 2), real matches 0.531-0.614 vs unrelated
0.428-0.437. 3.3 is DONE on the criterion "found by a differently-worded query". The gate was relaxed from top-1 to
top-3 after the result (disclosed in the script and DBG-037). Optional rerun to see which fact beat `retry`:
`HARNESS_OLLAMA_EMBED_MODEL=nomic-embed-text npx tsx scripts/smoke-phase3.ts`.
**Next up:** 3.4 compaction. Still waiting on the owner's answers: (a) same lesson = exact text or similarity?
(b) schedule trigger (manual / every N turns / wall clock; there is no `ctx.jobs` yet)? (c) who writes lessons, since
they are caller-supplied only (D-061)?

## 2026-10-03 (evening) — 3.3 Windows run: 530 passed / 7 skipped on rerun; real-model check still pending (DBG-036)
Owner's Windows run: first `npm test` had 1 timeout (cold LanceDB load, my test lacked the project's `vi.setConfig`
timeout; fixed), rerun 530 passed / 7 skipped. The smoke script ran offline because the shell was Git Bash (see below),
so paraphrase retrieval on a real model is STILL UNVERIFIED.
**Owner to run (Git Bash syntax):** `HARNESS_OLLAMA_EMBED_MODEL=nomic-embed-text npx tsx scripts/smoke-phase3.ts`
(PowerShell: `$env:HARNESS_OLLAMA_EMBED_MODEL="nomic-embed-text"` on its own line, then the npx line). Needs `ollama serve`
running and the model pulled. Paste the output.

## 2026-10-03 (later still) — 3.2 verified on Windows; 3.3 semantic tier built (D-063, DBG-035)
3.2 confirmed on the owner's Windows run: 518 passed / 7 skipped (as predicted), typecheck clean.
3.3: `ctx.memorySemantic` (add/query/reindex/remove/list), facts in `semantic.json`, LanceDB collection as a derived
index, `why` required, redaction, outage- and model-change-safe. 12 new tests, 13 mutations all caught. Linux sandbox
439 passed / 98 skipped.
**Owner to run (Windows):** `npm install`, `npm run typecheck`, `npm test` (expect 530 passed / 7 skipped), THEN the real
check, which is the one that matters for 3.3:
`$env:HARNESS_OLLAMA_EMBED_MODEL="nomic-embed-text"` then `npx tsx scripts/smoke-phase3.ts`. Paste the output. Until that
passes, "finds paraphrases" is only shown for a stand-in embedder, not a real one.
**Next up:** 3.4 compaction job (scheduled; promotes repeated episodic lessons into hot rules or procedures). Open design
questions for the owner: (a) what is "the same lesson" - exact text, or similarity (needs embedding episodes, which 3.1
deliberately did not do)? (b) what is the schedule trigger (`ctx.jobs` does not exist in this repo yet; N turns, wall
clock, or manual call)? (c) because lessons are caller-supplied only (D-061), compaction has nothing to promote until
something writes lessons; who will?

## 2026-10-03 (later) — 3.1 verified on Windows; 3.2 hot tier built (D-062, DBG-034)
3.1 confirmed by the owner's Windows run: 501 passed / 7 skipped, typecheck clean (as predicted).
3.2: `ctx.memory.hot` (add/replace/remove/list/render), token-capped (estimate chars/3, default 2000), whole-entry
priority trimming, injected into every agent run through the new `ctx.agentLoop.addSystemSection()`. 17 new tests,
9 mutations all caught. Linux sandbox 427 passed / 98 skipped.
**Owner to run (PowerShell, separate lines):** `npm install`, `npm run typecheck`, `npm test`; expect 518 passed / 7 skipped.
**Next up:** 3.3 semantic tier (architecture facts, only when non-trivial to reconstruct from code; backed by
`ctx.vectorstore`, so it needs `ctx.embeddings`). Open design question for the owner: who decides a fact is
"non-trivial to reconstruct from code" - the caller explicitly, or an automatic check? (I lean explicit caller +
a cheap guard that refuses facts already answerable by grep of the repo; automatic judgment would need a model call.)

## 2026-10-03 — Phase 3 started: 3.1 episodic memory built (D-061, DBG-033)
`bundle-memory` / `ctx.memory.episodic` written: `ctx.memory.runTurn()` runs a turn through the agent loop and
writes exactly one linked entry (task, approach from the log, result, outcome, optional caller-supplied lesson),
idempotent, redacted, JSONL-persisted, queryable by session/agent/task/outcome/time. Typecheck clean; 12 new
tests mutation-checked. Linux sandbox total 410 passed (98 skipped: no ripgrep there).
**Owner to run (Windows PowerShell, separate lines):** `npm install`, `npm run typecheck`, `npm test` and paste
the totals (expected roughly 501 passed / 7 skipped: 489 + 12).
**Still open from Phase 2:** a real chat model driving the loop (`HARNESS_OLLAMA_CHAT_MODEL`), `ollama list` for
the D-027 pin, a labelled retrieval benchmark (Phase 6), whether a 6-minute first index is acceptable.
**Next up:** 3.2 hot tier (token-capped, injected into the system prompt). Open design question for the owner:
what counts as a token when there is no tokenizer (D-061 did not need one; 3.2 does).

## 2026-10-01 (later) — Windows run of 2.6 passed; calibration and indexing cost measured (D-060)
Owner's Windows run: everything passed, including the 2.5/2.6 smoke checks with real
nomic-embed-text. Results led to D-060: similarity floor 0.60 for nomic (answerable 0.70-0.74
vs unanswerable 0.48-0.52), weight 0.5 stays the default, and indexing `src/` took 357 s,
so indexing is now incremental (unchanged files cost nothing; measured 0 embedded in 0.5 s).
Suite 489 passed / 7 skipped on Linux.
**Still open:** a real chat model driving the loop (`HARNESS_OLLAMA_CHAT_MODEL`, the true test
of 2.6), `ollama list` for the D-027 model pin, a labelled retrieval benchmark (Phase 6), and
whether a 6-minute first index is acceptable.
**Next up:** Phase 3 (memory + skills), or policy-gate coverage of the retrieval tools first.

## 2026-10-01 — Phase 2: 2.6 built; Phase 2 code complete pending the owner's runs (D-058, D-059)
`retrieval-tools` (`search_code`, `list_code_files`, read-only, nonce-fenced untrusted
data, bounded output) and the 2.6 end-to-end tests are written: the real agent loop,
registry, log and LLM service driving the full retrieval stack through a scripted,
context-faithful model, with negative controls. Suite 475 passed / 7 skipped.
**Owner to run (Windows PowerShell, separate lines):** `npm install`, `npm run typecheck`,
`npm test`, then `$env:HARNESS_OLLAMA_EMBED_MODEL="nomic-embed-text"` and
`npx tsx scripts/smoke-phase2.ts`. Please paste (a) the new "similarity of the best vector
match" table so a `minVectorScore` can be chosen (D-059), (b) the 2.5 top-3 lines at
weights 0 / 0.5 / 1, (c) `ollama list` (D-027 pin). Optional and the real test of 2.6:
`ollama pull` a chat model that supports tools, set `HARNESS_OLLAMA_CHAT_MODEL`, rerun.
**Phase 2 exit check:** every sub-phase has code and tests; open items are the owner's
runs above, a floor value, a labelled benchmark (Phase 6) and the embedding-model pin.
**Next up:** Phase 3 (memory + skills) per `docs/phases.md`, or first the policy-gate
coverage of the retrieval tools if Phase 5 is pulled forward.

## 2026-09-30 (before) — Phase 2: 2.1-2.4 verified on Windows; 2.5 built (D-056, D-057)
The owner's Windows run passed everything for 2.1-2.4 (DBG-030, D-057).
`retrieval-rank` is written: lexical candidates, BM25, optional vector side,
weighted rank fusion, content-hashed chunk ids so nothing stale is served;
`retrievalGrep.listFiles` added. Suite 439 passed / 6 skipped. **Owner to run:**
`npx tsx scripts/smoke-phase2.ts` with `HARNESS_OLLAMA_EMBED_MODEL=nomic-embed-text`
(it now indexes `src/`, takes a minute or so, and prints the top results for four
questions at weight 0, 0.5 and 1: please judge whether weight 0.5 or 1 beats 0),
and paste `ollama list` so the model digest can be pinned (D-027).
**Next up:** the read-only retrieval tool wrappers (they register `search_code`
and friends on `ctx.tools` with the right action class; the path and secret
protections already live in the bundles), then 2.6 (agent loop integration test).

## 2026-09-30 (later still) — Phase 2: 2.4 built (D-055)
`vectorstore-lancedb` written on embedded LanceDB pinned to 0.30.0 (D-055 has
the reason); fingerprint-guarded collections, source-scoped delete and query.
Suite 376 passed / 6 skipped. The smoke script now covers parse -> embed ->
store -> query -> restart -> wrong-fingerprint -> delete. **Owner to run** on
Windows: `npm install` (fetches the win32 binary), then the smoke script.
2.1-2.4 are all still awaiting that run.
**Next up:** 2.5 rank (BM25 over grep + parse candidates, hybrid with vector
similarity only when `ctx.embeddings` and the store work), the read-only
retrieval tool wrappers, then 2.6.

## 2026-09-30 (later) — Phase 2: 2.3 built (D-054)
`embeddings` written: Ollama provider (real-HTTP tested), hashing stand-in,
batching/dedupe/fingerprint. Suite 343 passed / 6 skipped. **Owner to run:**
`scripts/smoke-phase2.ts` and the opt-in Ollama tests on Windows (rg.exe,
`ollama pull`), then pin the embedding model digest (D-027). 2.1 and 2.2 also
still await that Windows run.
**Next up:** 2.5 rank (BM25 only, embeddings optional and used only when
`ctx.embeddings` works), retrieval tool wrappers (read-only, root/secret
protections), then 2.6; 2.4 (LanceDB) after that.

## 2026-09-30 — Phase 2: 2.1 and 2.2 built (D-051, D-052, D-053)
`retrieval-grep` (2.1) and `retrieval-treesitter` (2.2) are written and tested
against real ripgrep and real grammars; suite 306 passed / 3 skipped, `tsc`
clean. Neither is wired into a profile or exposed as a model tool yet. Not yet
run on the owner's Windows machine. Phase 1 carry-overs: 1B.4, 1.2b, Qwen
license (D-049).
**Next up:** the order changes (D-051 area): 2.5 rank (BM25 only, embeddings
optional, per D-028) before 2.3/2.4, then read-only retrieval tool wrappers
with root/secret protections (not in any phase's file list yet), then 2.6.

## 2026-09-29 (last) — Needle pinned (D-050)
1B.3 is complete. Remaining for Phase 1: confirm Tauri and build 1B.4, live
OpenRouter call (1.2b). Qwen reference worker must be replaced/licensed before
commercial release (D-049).

## 2026-09-29 (late) — Needle generation chosen; Phase 1 close-out list
Owner chose needle2 and confirmed commercial use is in scope (D-049). Needle pin
still needs `npm run pin` on the downloaded files. Remaining to close Phase 1:
Needle pin (1B.3), confirm Tauri and build the desktop app (1B.4), a live
OpenRouter call (1.2b, unverified 429 heuristic). Qwen reference worker must be
replaced or licensed before any commercial release.

## 2026-09-29 (night) — bench complete; Tauri chosen provisionally (D-048)
Valid numbers in hand. Tauri chosen provisionally, pending a measurement of the
Node core as a sidecar. **Open, needing you:** confirm or reject Tauri; Needle
generation + `npm run pin`; Qwen commercial-use question.

## 2026-09-29 (evening) — first bench numbers; memory measurement fixed
Sizes and start times recorded, idle memory invalid (0.0) and fixed (D-047).
No shell chosen. **Open, needing you:** rerun `npm run measure:electron` and
`measure:tauri`, paste `results.csv`; Needle generation + `npm run pin`;
whether commercial use of the Qwen reference worker is ever needed.

## 2026-09-29 (later) — audit gap fixed; 1B.4 toolkit; Needle sources found
Blocked budget calls now log `budget.blocked` (D-044). 1B.4 measurement
scripts written but not run (D-045). Needle: real sources and Apache-2.0 tags
found for needle2/needle3, but no pin - needs a download on your machine, and a
choice of which generation (D-046). Suite 247/3.
**Open, all needing you:** run the two bench scripts and paste `results.csv`;
pick a Needle generation, download it, run `npm run pin`.

## 2026-09-29 — 1B.2 closed; installed-vs-pinned; timeout fix
Added `harness run` (one real call, budget spent first) and used it to
close 1B.2's offline-start and budget-stop tests. `doctor` now compares the
pinned model against what Ollama reports as installed. Local connection
timeout raised to 120 s. Suite 247 passed / 3 skipped (D-043, DBG-021).
**Open:** Needle pin (needs your source/digest, deferred to 4.5); first real
`run` against your Ollama; 1B.4 desktop shell (needs your 8 GB machine).

## 2026-09-28 — 1B.3: real reference-worker pin registered
Real digests from your `ollama pull` are now in `model-store/pins.ts`; the
wizard shows the `worker` binding in `doctor`. **License finding:** the
model is under the Qwen Research License - non-commercial use only (D-042).
Tests 236 passed / 3 skipped. Open: Needle pin (deferred to 4.5); no
installed-vs-pinned check; 1B.2's offline-start/budget-stop tests still
wait on a "run a task" command.

## 2026-09-27 — 1B.3: model store built — mechanism done, one data gap open
**Current phase:** 1B.2 is substantively complete (open items noted last
entry). 1B.3 (model store and pinning, D-027) is now built: `ctx.modelStore`
(`src/bundles/model-store/`) registers models against a fixed source
allowlist (`ollama-library`, `ornith-ai`, `cactus-compute`), verifies a
digest against its pin (refuses any mismatch), and resolves each named
binding to its pin, a registered fallback, or "unavailable" -
`doctor`'s `models` field (new, optional) now reports this when a
`ModelStore` is passed in.
**Open by design, not oversight:** the store ships with **zero
pre-registered models**. D-026 (Needle) and D-030 (the reference worker,
`qwen2.5-coder:3b-instruct`) both name a model but neither recorded a
checked SHA-256 for a specific pulled revision, and this environment has
no network access to Ollama's registry or Hugging Face to compute one for
real. Registering an invented digest would be a fabricated claim - the
same thing `consent-copy.ts` already refuses to do for a provider's
privacy policy (D-020, D-037), just for a hash instead. So 1B.3's third
success criterion ("Needle version and license file recorded") is
genuinely open, not just untested - it needs someone with real network
access to actually pull the models and register their real digests. See
`docs/phases.md` 1B.3 for the full breakdown of what's done vs. open.
**Last debug:** DBG-019 — see `docs/debug.md`. Also caught, while writing
that entry: `docs/architecture.md` hadn't been updated since 2026-09-24 -
three sessions' worth of 1B.2 work (provider connection test, `doctor`,
the wizard CLI) had gone undocumented there even though every one of them
updated `phases.md`/`decisions.md`/`debug.md`/`status.md`. Fixed in this
same pass; worth remembering to check that file on every future slice.
**Last decisions:** D-041 — the fixed source allowlist, why no models are
pre-registered, why the store is in-memory only, `doctor`'s new optional
`models` parameter.
**Test state:** 234 passed, 3 skipped (up from 215/3). `tsc --noEmit`
clean. Three mutations (disable the allowlist check; disable the digest
comparison; make `doctor`'s `models` field default to `[]` instead of
staying absent) each broke the test written for it.
**Watch:**
- `ModelStore` is not wired into `src/cli/wizard.ts` yet - the wizard
  never constructs one, so `doctor`'s `models` field stays absent on
  every real wizard run today. Wiring it in (and deciding what, if
  anything, the wizard should ask about model pinning) is open.
- No persistence to disk - a `ModelStore` is empty again on every
  restart. Not worth building against zero real data (same reasoning as
  the pre-registration gap above); revisit once real pins exist.
- Router (Phase 4.5, Needle) depends on this bundle and is still
  unstarted - unaffected by today's gap since it was already blocked on
  much more than a recorded digest.
**Next up:** either (a) get real network access to compute real digests
for the reference worker and Needle and close 1B.3's open criterion, (b)
wire `ModelStore` into the wizard, or (c) move on to a different phase
entirely (Phase 4.5/router still needs `bundle-model-store` but has its
own larger unstarted scope; Phase 2/retrieval and Phase 5/sandbox remain
fully unstarted). Your call.

## 2026-09-26 — 1B.2: terminal wizard CLI done (slice 6) — every listed 1B.2 piece now built
**Current phase:** 1B.2 substantively complete. Every piece
`docs/phases.md` originally listed for this phase is now built: budgets,
credentials, consent copy, the provider connection test, `doctor`, and now
the terminal wizard CLI that actually wires the first four together and
ends with the fifth. Only offline-start and budget-stop *integration*
tests remain open, and both wait on a "run a task" command that doesn't
exist yet.
`npm run wizard` (`src/cli/index.ts`) walks: project ID → provider choice
(mock/ollama/openai-compatible) → credential storage (with a round-trip
check before ever using the key) → the connection test (D-038's
`acknowledgeRemote` gate for remote providers) → the consent screen →
an optional daily budget → a final `doctor` report. This is the first
place `EgressPolicy` and `AppCore` are booted onto the same `Context`
together — `bootProfileMinimal` still doesn't touch `AppCore` (unchanged
from D-039). Deliberately setup-only: doesn't register the provider on
`ctx.llm`, doesn't boot `LLMService`, doesn't run anything.
**Last debug:** DBG-018 — see `docs/debug.md`.
**Last decisions:** D-040 — why setup-only, why `WizardIO` is an
abstraction over the real terminal, why `TerminalIO`'s `secret` option
doesn't actually mask input, and two things found by hand (a Node
`readline/promises` limitation with piped stdin, and a real
`process.exit()`-truncates-piped-stdout bug, now fixed).
**Test state:** 215 passed, 3 skipped (up from 203/3). `tsc --noEmit`
clean. Two mutations (disable the credential round-trip guard; hardcode
`acknowledgeRemote = true`) each broke the test written for it.
**Watch:**
- `TerminalIO`/`index.ts` (the real terminal I/O) are not exercised by the
  automated suite at all — `test/wizard.test.ts` tests `runWizard` through
  the `WizardIO` interface with a scripted fake. Real terminal behavior
  was verified once, by hand, via a pty (Python's `pty` module driving the
  actual CLI with delayed scripted keystrokes) — confirmed working
  end-to-end for the mock-provider path, exit status 0. Not something CI
  re-checks on every run.
- A plain piped/non-interactive invocation of the real CLI (`echo ... |
  npm run wizard`) does **not** work — Node's `readline/promises`
  `question()` hangs after the first call on non-TTY stdin. Confirmed this
  is a Node limitation, not a bug in this code, by reproducing it in a
  4-line isolated script and then showing the identical input works fine
  over a real pty. No scripted/CI-driven E2E test of the real CLI is
  possible without building a pty-based test harness — judged out of
  scope for this slice.
- `TerminalIO`'s `secret: true` prompt option does not mask input (no
  asterisks) — only prints a one-line warning first. Documented, not
  hidden (D-040).
**Next up:** offline-start and budget-stop integration tests, both of
which need something that actually calls a provider through `LLMService`
to integrate against — likely means building a minimal "run" command
first (out of scope of anything decided so far, would need its own
phases.md entry / decision before starting).

## 2026-09-26 — 1B.2: `doctor` done (slice 5) — every standalone 1B.2 piece now built
**Current phase:** 1B.2, still in progress — but every piece except the
CLI client itself is now done.
`ctx.appCore.doctor(egress)` gives a read-only report: budgets remaining
(`Budgets.status()`/`requestsLeftToday()`, already existed), which
credential backend is active (new `describeCredentialStore` +
`AutoCredentialStore.which()`), current consent state and the egress
allowlist (new, read-only `EgressPolicy.status()`). Deliberately scoped to
what's built — no "active binding", remote-sandbox, or pinned-model/offline
reporting, since none of those exist yet (D-039); extends when 1B.3 and
Phase 5 land, not before.
**Last debug:** DBG-017 — see `docs/debug.md`.
**Last decisions:** D-039 — scope boundary for `doctor`, and why it takes
`egress` as a parameter rather than reading `ctx.egress` (same reason
`consentScreen` does: `bundle-app-core` isn't wired into any profile yet).
**Test state:** 203 passed, 3 skipped (up from 190/3). `tsc --noEmit`
clean. Two mutations (hardcode which credential backend "resolved";
drop `decidedAt` from egress status) each broke the test written for it.
**Watch:**
- `bundle-app-core` is still not booted anywhere (`bootProfileMinimal`
  doesn't call `ctx.plugin(AppCore, ...)`) — every 1B.2 piece so far
  (budgets, credentials, consent copy, connection test, `doctor`) is
  tested standalone, not through a real `ctx`. First real integration
  point is the CLI client.
- `doctor`'s credential-backend detection triggers `AutoCredentialStore`'s
  probe if it hasn't run yet (same cost as any other first call) — calling
  `doctor` is not free the very first time, same documented limitation as
  everywhere else `which()`/`resolve()` shows up.
**Next up:** the terminal wizard CLI client (`src/cli/`) — the thing that
actually wires `ctx.plugin(AppCore, ...)` into a runnable profile and calls
credentials, consent screen, connection test and `doctor` in sequence, then
the offline-start and budget-stop integration tests that depend on it
existing.

## 2026-09-26 — 1B.2: provider connection test done (slice 4)
**Current phase:** 1B.2, still in progress.
`ctx.appCore.testConnection(provider, opts)` lists models (best-effort)
then makes one tiny timed probe call against an already-constructed
`LLMProvider`, and never throws — it returns a structured result the
wizard renders directly. A remote provider needs `acknowledgeRemote: true`,
a narrower one-off gate separate from `ctx.egress`'s persisted per-project
consent, since the connection test has to work *before* that consent
exists (wizard order: connection, then consent). `LLMProvider` gained an
optional `listModels?()`, implemented for `OllamaProvider` and
`OpenAICompatibleProvider`.
**Last debug:** DBG-016 — see `docs/debug.md`.
**Last decisions:** D-038 — the `acknowledgeRemote` gate and why it's
separate from D-029's project consent; the shared listing+probe timeout.
**Test state:** 190 passed, 3 skipped (up from 176/3). `tsc --noEmit`
clean. One mutation (disable the `acknowledgeRemote` gate) broke the test
written for it. One real bug caught by a test hanging on first run (not a
deliberate mutation): model listing had no timeout of its own, so a hung
listing endpoint would have hung the whole connection test forever; fixed
by sharing one deadline across both calls, re-ran clean.
**Watch:**
- Not yet called from anywhere real — no CLI/wizard client exists yet
  (`src/cli/` is still unbuilt). That's next.
- Not tested against a real Ollama or OpenRouter host, only the fetch-mock
  pattern already used elsewhere in the suite — same caveat as 1.2b's
  429-wording heuristic (unverified against the live API).
**Next up:** `doctor` (the other unstarted 1B.2 piece — read-only status
across budgets/credentials/consent/egress allowlist), then the terminal
wizard CLI client (`src/cli/`) that actually calls all four 1B.2 pieces
built so far, then the offline-start and budget-stop integration tests.

## 2026-09-24 — 1B.2: consent-screen copy/data done (slice 3)
**Current phase:** 1B.2, still in progress.
`ctx.appCore.consentScreen(providerName, egress?)` now returns D-020's
general statement plus a specific binding's plain-language destination
plus, only for providers actually checked against a real source
(`ollama`, `openrouter` so far), a dated data-policy claim. An unknown
provider gets an explicit "no checked policy on file" line, not silence
and not a guess.
**Last debug:** DBG-015 — see `docs/debug.md`.
**Last decisions:** D-037 — paraphrased/sourced/dated claims only,
`lookupProviderPolicy` returns `undefined` rather than fabricating
anything for a provider not in the registry.
**Test state:** 176 passed, 3 skipped (up from 169/3). `tsc --noEmit`
clean. Two mutations (fabricate a claim for an unknown provider;
hard-code "local" regardless of actual egress) each broke 2 tests - the
second one is the one that mattered most (a real cloud call falsely
reporting nothing left the machine).
**Not built yet, still open in 1B.2:** provider connection + connection
test; `doctor`; the terminal wizard CLI itself (`src/cli/`);
offline-start test. Budgets, credentials, and consent copy are all
library-grade now but still have no caller - nothing in the codebase
actually presents this consent screen, spends a budget, or reads a
stored key from a real flow yet.
**Next up:** provider connection + connection test is the natural next
slice (the wizard needs something to actually call before it has
anything to show budgets/consent/credentials working against), or
`doctor` (a read-only status check across everything built so far) if the
owner would rather have that first. Confirm before starting.

## 2026-09-24 — 1B.2: credential storage done (slice 2)
**Current phase:** 1B.2, still in progress. `ctx.appCore.credentials`
now exists: `AutoCredentialStore` tries the OS keychain
(`@napi-rs/keyring`), verifies it with a real set/read/compare probe
before trusting it (a broken backend was found, by hand, to fail
*silently* on read in some environments - not a hypothetical), and falls
back automatically to an AES-256-GCM encrypted file when the probe
fails.
**Last debug:** DBG-014 — see `docs/debug.md`.
**Last decisions:** D-036 — verify-don't-trust design for the keychain,
stated (not glossed-over) limitation of the file-store fallback's
encryption, new dependency `@napi-rs/keyring` checked for a Windows
prebuilt binary before adding.
**Test state:** 169 passed, 3 skipped (up from 155/3). `tsc --noEmit`
clean. Two mutations (ignore the probe result; swallow decrypt/tamper
errors) each broke multiple tests.
**Not built yet, still open in 1B.2:** provider connection + connection
test; consent-screen copy/data; `doctor`; the terminal wizard CLI itself
(`src/cli/`); offline-start test; nothing calls `Budgets.spend()` or
`ctx.appCore.credentials` yet from a real flow - both are library-grade
but have no caller until the wizard exists.
**Next up:** continuing 1B.2 - consent-screen copy/data (D-020's "plain
about what the provider receives") is the natural next slice, since
budgets + credentials + egress consent (1B.1) are now all in place for
the wizard to actually present a first-run screen against. Confirm with
the owner before starting.

## 2026-09-24 — 1B.2 started: budgets done, rest of 1B.2 still open
**Current phase:** 1B.2, in progress (not done - it's a multi-piece
phase, sliced same as 1.2b/1.6/1B.1). `bundle-app-core` (`ctx.appCore`)
now exists with `Budgets` (`ctx.appCore.budgets`): task/session/day
soft+hard limits on requests and tokens, a persisted day counter
(survives restart, UTC rollover, mirrors `RateLimiter`'s pattern from
D-023), and an all-or-nothing `spend()` that throws
`BudgetExceededError` with a full status report before recording
anything, if any scope would go over hard.
**Last debug:** DBG-013 — see `docs/debug.md`.
**Last decisions:** D-035 — all-or-nothing spend across scopes (never
leave scopes out of sync with each other); day-counter persistence
copies `RateLimiter`'s design rather than sharing code with it (same
shape, different unit and different consumer).
**Test state:** 155 passed, 3 skipped (up from 140/3). `tsc --noEmit`
clean. Two mutations (disable hard-limit check; break cross-scope
atomicity) each broke several tests.
**Not built yet, still open in 1B.2:** nothing calls `Budgets.spend()`
yet (no real call site to budget-stop test against); provider connection
+ connection test; credential storage (OS credential store + encrypted-
file fallback with a warning); consent-screen copy/data (D-020's "plain
about what the provider receives" requirement); `doctor`; the terminal
wizard CLI itself (`src/cli/`, D-025); offline-start test.
**Next up:** continuing 1B.2 - credential storage is the natural next
slice (budgets and consent both eventually need somewhere to keep a
provider API key; the wizard can't do much without it). Confirm with the
owner before picking a credential-store library, since it likely means a
new dependency and needs to work on the Windows 8 GB target machine
without heavy native build tooling.

## 2026-09-24 — 1B.1 egress controls done
**Current phase:** Phase 1B.1 complete. `bundle-egress` (`ctx.egress`) is
live and mandatory: per-project consent (persisted via `FileConsentStore`
or in-memory for tests), an endpoint allowlist, and redaction of
registered secret values from every outbound request body and the
`model.request` log entry. Sits alongside the existing D-022 binding flag,
not in place of it — both gates must pass for a remote call.
**Last debug:** DBG-012 — see `docs/debug.md`.
**Last decisions:** D-034 — two independent consent gates on purpose (a
binding-config fact vs. a persisted per-project decision), so a refusal's
reason is unambiguous. "Secrets proxy" turned out to already be satisfied
structurally for provider API keys (D-022) — 1B.1's real addition is
`redactValue` for *other* secrets in message/tool content.
**Test state:** 140 passed, 3 skipped (up from 122/3). `tsc --noEmit`
clean. Three separate mutations (bypass project-consent check, bypass
allowlist check, skip redaction) each broke exactly the test built for it.
**Known limitations (not blocking, logged in D-034):**
`FileConsentStore` is a plain JSON file, fine for one process, not
concurrency-safe. Redaction matches literal registered secret values only
— no pattern-based detection of an unregistered credential.
**Not built yet:** consent-screen copy and the interactive wizard (1B.2).
**Next up:** 1B.2 (wizard core, budgets, `doctor`), 1B.3 (model store and
pinning), 1B.4 (desktop shell) remain in Phase 1B, or Phase 2 (retrieval
pipeline) — owner said Phase 2 is next after 1B.1, so that's the plan
unless redirected.

## 2026-09-24 — 1.6 `profile-minimal` done; Phase 1 complete
**Current phase:** Phase 1 (`profile-minimal` kernel) — all of 1.1-1.6 now
Done. `bootProfileMinimal()` composes session-log, model-adapter,
tool-registry, subprocess and agent-loop behind one config call.
**Last debug:** DBG-011 — see `docs/debug.md`.
**Last decisions:** D-033 — `profile-minimal` boots via a plain TS
composer (`ctx.plugin()` × 5), not real `cordis.patch.yml`, because the
loader that mechanism needs (`@cordisjs/plugin-loader` +
`@cordisjs/plugin-include`) is an uninstalled optional peer dependency of
`cordis`. Reopen for `profile-research`/`profile-full` if multiple named,
independently loadable profiles or hot reload become necessary.
**Test state:** 122 passed, 3 skipped (up from 117/3). `tsc --noEmit`
clean. New `test/profile-minimal.test.ts` mutation-checked (a shared-ctx
simulation broke 3 of 5 tests).
**Not built yet:** no real provider (Ollama/OpenRouter) has been run
through the composed profile end-to-end yet - `test/profile-minimal.test.ts`
uses `MockProvider` throughout, same as 1.5. That's naturally covered once
a real task is run against `profile-minimal` with `modelAdapter.ollama`
configured, which isn't blocking (the loop and the wire-format adapters
are each independently tested against real shapes already).
**Open for the owner, unchanged from before:** Electron/Tauri measurement
(D-025), Needle version to pin (D-026), confirm `qwen2.5-coder:3b-instruct`
speed (D-030).
**Next up:** Phase 1B (egress controls, 1B.1) is next per `phases.md` — it
must land before the harness sends real code to a cloud provider — or
Phase 2 (retrieval pipeline) if cloud access isn't needed yet. Confirm
which with the owner before starting.

## 2026-09-22 — D-031 resolved: Windows behavior root-caused, 1.6 un-gated
**What happened:** the owner ran `scripts/diagnose-windows-env.cjs` and
reported the output. It conclusively showed the "leak" is Node's own,
deterministic, platform-mandatory behavior on Windows (11 non-secret
baseline env vars always injected when spawning), not a bug in this
project and not machine-specific — a raw, bundle-independent `spawnSync`
call reproduced it with zero involvement from our code.
**Status change:** 1.4 is now Done and verified on Linux AND Windows
(D-032 supersedes the "not verified" framing in D-031, without deleting
that entry). 1.6 (`profile-minimal`) is un-gated.
**What I did:** added `WINDOWS_REQUIRED_ENV_VARS` as an explicit,
documented, platform-conditional constant; rewrote the security tests to
check the actually-achievable property (nothing beyond the allowlist plus
this fixed, named baseline) via a new `expectChildEnv()` helper, plus a
dedicated test pinning the baseline's exact contents so a future Node
change would surface as a specific failure. Corrected the "not even PATH"
absolute claim in `readme.md`/`code_logic.md` to the precise version.
**Test state:** 117 passed, 3 skipped on Linux (unaffected — the baseline
constant is empty there, so POSIX behavior is unchanged from before any of
this). Mutation-checked that a real full-env leak still fails 5 of 6
security tests even with the new, more permissive-on-Windows helper.
**NOT yet done:** the owner hasn't re-run the actual test suite on Windows
with this fix applied — the analysis is solid from the diagnostic data,
but I'd like that confirmation before calling this fully closed.
**Open for the owner:** run `npx vitest run test/subprocess.test.ts` on
Windows one more time to confirm all 18 pass now; Electron/Tauri
measurement (D-025); Needle version to pin (D-026); confirm
`qwen2.5-coder:3b-instruct` speed (D-030).
**Next up:** 1.6 (`profile-minimal` end-to-end wiring) — no longer blocked.

## 2026-09-22 — 1.5 agent-loop done (built in parallel with the D-031 fix, per owner)
**Current phase:** Phase 1; 1.1–1.5 done. 1.6 (profile-minimal) is next,
but is explicitly gated on D-031 being resolved and re-verified on
Windows first (see phases.md 1.6) — a runnable profile that shells out is
exactly where an unverified env-allowlist would matter for real. 1.5
itself has no dependency on subprocess (only `MockProvider`, `ctx.llm`,
`ctx.tools`), so building it in parallel with the D-031 fix, as the owner
asked, didn't touch anything D-031-related.
**Last debug:** DBG-009 (1.5). D-031 (env-allowlist on Windows) is still
open — see the previous entry below; nothing here resolves it.
**Docs changed:** `phases.md` (1.5 Done, full testing detail; 1.6 marked
gated on D-031), `architecture.md` (agent-loop detail, registered-as-
`ctx.agentLoop` note, file tree), `code_logic.md` (retry/fallback dispatch,
bounded reflection, why no loop-level logging), `debug.md`, this file.
**Test state:** 116 passed, 3 skipped (live). 15 new agent-loop tests,
mutation-checked (skipped retryable check, loosened maxSteps, removed
reflect-once guard, dropped provider override each break the intended
test).
**Not built yet:** no real provider has been run through the loop end to
end (`MockProvider` only); that happens once 1.6 composes
`profile-minimal` — which is blocked on D-031 first.
**Open for the owner, unchanged plus one:** Electron/Tauri measurement
(D-025), Needle version to pin (D-026), confirm `qwen2.5-coder:3b-instruct`
speed (D-030), and — still the most important one — run
`node scripts/diagnose-windows-env.cjs` on Windows and report the output
(D-031), which is what unblocks 1.6.
**Next up:** resolve and re-verify D-031, then 1.6 (`profile-minimal`
end-to-end wiring).

## 2026-09-22 — Windows run found a real gap: env-allowlist not verified there
**What happened:** the owner ran the 1.4 work on their actual Windows
machine (the whole point of testing there). 3 of 5 env-allowlist security
tests failed: a child process received 11 system env vars (PATH, USERNAME,
TEMP, and 8 more) that it should not have, with an empty or near-empty
allowlist. The named test secret did not leak in that run. One passing
test turned out to be weak (checked only one var, not the whole
environment) and has been fixed to check fully.
**Status change:** 1.4 downgraded from "Done" to "Done on Linux, NOT
verified on Windows" (D-031). Don't treat the env-allowlist as a real
security boundary on Windows until this is resolved.
**What I did:** fixed the weak test; wrote and self-tested (on Linux)
`scripts/diagnose-windows-env.cjs`, a dependency-free diagnostic that
isolates whether this is Node/Windows platform behavior or something
specific to this project's code, independent of `src/bundles/subprocess`.
Did NOT ship a guessed fix to the actual leak — I have no Windows machine
to verify one on, and a fix I can't confirm works is worse than an honest
"not yet verified."
**Test state:** 101 passed, 3 skipped on Linux (unchanged, since the fixed
test still passes here). Windows: last known state 98 passed / 3 failed,
pending a re-run after this commit (the fix only closes the assertion gap,
it doesn't address the leak, so 2 of the 3 Windows failures are expected to
still fail until D-031 is resolved).
**Next up, in order:** (1) owner runs
`node scripts/diagnose-windows-env.cjs` on Windows and reports the output —
this decides whether the fix belongs in `Subprocess.run` or somewhere
platform-specific; (2) once resolved and re-verified on Windows, resume 1.5
(agent-loop).

## 2026-09-22 — 1.4 subprocess done
**Current phase:** Phase 1; 1.1 through 1.4 done. Next is 1.5 (agent-loop).
**Last debug:** DBG-007 (1.4). Includes a near-miss note: a doc-editing
script bug briefly truncated `phases.md` to empty; caught via `wc -l`
before commit and reverted with git, nothing lost.
**Last decisions:** none new; D-030 (previous entry) still current.
**Docs changed:** `phases.md` (1.4 marked Done, full detail),
`architecture.md` (subprocess detail, file tree), `code_logic.md` (env
allowlist and result-vs-throw logic), `debug.md`, this file.
**Test state:** 101 passed, 3 skipped (live). 17 new subprocess tests,
mutation-checked (env leak, skipped allowlist guard, swallowed exit code
each break the intended test).
**Not built yet:** no tool wraps `ctx.subprocess` for the agent loop; that
plus the `sandbox-write`/`real-fs-write` action-class call for a shell-out
tool is 1.5 and Phase 5 (`policy-gates`).
**Open for the owner:** unchanged — Electron/Tauri measurement (D-025),
Needle version to pin (D-026), confirm `qwen2.5-coder:3b-instruct` speed
and whether the 7B tag is also worth trying (D-030). Also: run
`npx vitest run test/subprocess.test.ts` on the actual Windows machine to
confirm it behaves the same there (only run in Linux sandbox so far).
**Next up:** 1.5 agent-loop — ReAct loop over 1.2 to 1.4, with the retry
policy from D-023.

## 2026-09-22 — Reference worker: local Ollama, not OpenRouter
**What changed:** the owner checked OpenRouter's model search directly —
"ornith" returns "No results found." Ornith-1.5 9B is confirmed absent from
OpenRouter (closes the open item from D-027 and the prior status entry). The
owner will run a model locally through Ollama for now rather than a cloud
provider. Reference model set to `qwen2.5-coder:3b-instruct` (D-030), sized
for the 8 GB, no-GPU machine; `qwen2.5-coder:7b-instruct` recorded as a
stretch option, not default, since 7B is reported to need the whole 8 GB on
its own with no headroom for the OS, harness host and Needle. No code
changed: `OllamaConfig.model` already takes any tag with no built-in
default (D-018), so this only updates the docs, decisions and status.
**Docs changed:** `decisions.md` (D-030), `trd.md`, `readme.md`.
**Test state:** unchanged, 84 passed, 3 skipped (live).
**Open for the owner:** still the Electron/Tauri measurement (D-025) and
which Needle version to pin (D-026). Confirm `qwen2.5-coder:3b-instruct`
actually runs at an acceptable speed on the 8 GB machine; if it does, decide
whether to also try the 7B tag.
**Next up:** 1.4 subprocess, then 1.5 agent-loop, then 1.6 profile-minimal.

## 2026-09-22 — Cloud provider path, docs brought up to date
**Current phase:** Phase 1; 1.1, 1.2, 1.2b, 1.3 done. Next is 1.4.
**Last debug:** DBG-006 (1.2b).
**Last decisions:** D-020 to D-029: data claim rewritten, provider-agnostic
worker with OpenRouter first, egress consent, rate limiting, sandbox plan
(Crabbox free routes, CubeSandbox and Langfuse deferred), interface plan,
Needle, model pinning, embeddings BM25-first, egress before first cloud run.
**Docs changed:** `context.md`, `decisions.md`, `phases.md` (1.2b, Phase 1B,
4.5, amended 1.5, 2.3, 2.5, 5.1, 5.2, 6.3), `architecture.md` (new planned
bundles, dependency register), `trd.md`, `prd.md`, `appflow.md`,
`code_logic.md`, `workflow.md`, `readme.md`.
**Test state:** 84 passed, 3 skipped (live).
**Watch:**
- Free OpenRouter quota is 50 requests a day (owner chose not to buy the $10
  credit), so live tests must be sparing. Use the mock and recorded fixtures.
- Redaction and the secrets proxy are not built. Do not send real code to a
  cloud provider until 1B.1 exists, or accept that content is unredacted.
- The 429 quota heuristic is unverified against the live API.
**Open for the owner:** is Ornith-1.5 9B listed on OpenRouter for your
account; run the Electron and Tauri measurement on the 8 GB machine; which
Needle version to pin.
**Next up:** 1.4 subprocess (env allowlist security test), then 1.5
agent-loop with the retry policy from D-023, 1.6 profile-minimal, then 1B.1.

## 2026-09-20 — 1.2 done, 1.3 done
**Current phase:** Phase 1; 1.1, 1.2, 1.3 done. Next is 1.4.
**Last debug:** DBG-005 (1.3), DBG-004 (1.2 live).
**Last decisions:** D-019 (tool registry choke point, hooks, required
`actionClass`, `ajv`).
**Watch:** live tool-calling with a real local model is unverified until
1.5; expect ~25s per reply on the current setup.
**Next up:** 1.4 subprocess (env allowlist security test is the important
one), then 1.5 agent-loop, 1.6 profile-minimal.

## 2026-09-20 — 1.2 switched to Ollama
**Current phase:** Phase 1, sub-phase 1.2 (live-call verification pending).
**Last debug:** DBG-003. **Last decisions:** D-018 (Ollama replaces Anthropic).
**Blocked on:** run once with Ollama running and a model installed:
`HARNESS_LIVE=1 OLLAMA_MODEL=<installed tag> npx vitest run test/model-adapter.test.ts`
then log the result and mark 1.2 Done.
**Next up:** 1.3 tool-registry (independent of the live test).

## 2026-09-20 — Sub-phases 1.1 done, 1.2 code-complete
**Current phase:** Phase 1, sub-phase 1.2 (live-call verification pending).
**Last debug:** DBG-002 (1.2), DBG-001 (1.1).
**Last decisions:** D-012 to D-017 (Cordis pin, Bundler resolution, Python
project removed, `ctx.llm` design, adapter-owned logging).
**Blocked on:** run the live test once:
`HARNESS_LIVE=1 ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=... npx vitest run test/model-adapter.test.ts`
and log the result; only then mark 1.2 Done.
**Next up:** 1.3 tool-registry (can proceed in parallel), then 1.4
subprocess, 1.5 agent-loop, 1.6 profile-minimal.

## 2026-09-18 — Docs system scaffolded from design draft
**Current phase:** Pre-Phase 1 — no code yet. Full architecture, bundle
list, profile composition, and guardrail design are locked (see
`docs/decisions.md` D-001 through D-011).
**Last debug:** DBG-000 — docs scaffold only, N/A.
**Last decisions:** D-011 — explicitly out-of-scope repos noted.
**Next up:** Confirm real project root path (currently placeholder
`~/projects/coding-harness`), then hand sub-phase 1.1 (session-log bundle)
to opencode. `docs/phases.md` now breaks every phase into sub-phases with
their own success criteria and tests — work one sub-phase at a time.

---
**Next:** Return to [`context.md`](../context.md).


## 2026-11-05 — Consolidated audit closeout (branch `work/audit-closeout-2026-11`)

This entry distinguishes code present from acceptance evidence. No machine-specific or credential-dependent result is claimed by this repository edit.

### Complete in the inspected source tree

- **ENG-04 (project license text):** Apache License 2.0 is added as `LICENSE`. This licenses this repository's original work only; it does not relicense third-party dependencies or model weights. Third-party notices still require a dependency inventory before redistribution.
- **BUG-07 / BUG-09:** cross-process lock integration is present in session and semantic-memory persistence. Lock correctness remains limited to the supported local-filesystem assumptions documented in the implementation.
- **BUG-12 (service wiring):** `profile-coding` loads `MemorySemantic` only when both embeddings and vector-store configuration are present. This verifies service startup wiring, not a real-task retrieval quality claim.
- **ARCH-02 (partial integration):** current profile wiring includes the router and optional shadow tool decision. No decision class is authorized for Needle ownership without a real Needle comparison.
- **Phase 6 harness:** `scripts/eval-calibrate.ts` supports real JSONL logs and human labels. The repository currently contains too few real labels to claim Phase 6.2/6.4 complete.

### Open acceptance gates (not marked complete)

| ID | State | Evidence still required |
|---|---|---|
| ARCH-01 | OPEN | Crabbox doctor and real lease/run/release pass on the target Windows/Docker host, then route `run_command` through the provider with no host fallback. Keep host execution visibly classified as real-fs-write until then. |
| ENG-04 | PARTIAL | `LICENSE` added. Complete third-party notices only after generating and reviewing the exact dependency/license inventory for the shipped distribution. |
| ENG-08 Qwen license | DECIDED FOR ALLOWLIST, NOT GLOBAL | Exact Qwen2.5-Coder-7B-Instruct (Hugging Face repo `Qwen/Qwen2.5-Coder-7B-Instruct`) is tagged Apache-2.0; Qwen2.5-Coder-3B-Instruct (repo `Qwen/Qwen2.5-Coder-3B-Instruct`) is tagged `qwen-research`, whose agreement grants non-commercial rights only and says commercial users must request a license. Decision: allowlist only a specifically pinned 7B artifact for commercial distribution, subject to revision/hash verification; reject the 3B model for commercial distribution absent a separate written license. |
| Phase 6.2 | OPEN | At least 20 actual model-driven runs, labeled independently before viewing scores, with both good and bad outcomes. Commit labels and session-log provenance. |
| Phase 6.4 | OPEN | Run calibration on the committed real log set; record scorer version, threshold, agreement, disagreements, and reproducible command/output. |
| ARCH-02 Needle evaluation | OPEN | Provide a real Needle executable/wrapper and pinned model files; run `scripts/eval-router.ts`, then run shadow comparisons over real tasks. Script stand-ins are not evidence. |
| ARCH-02 ownership decision | SAFE DEFAULT | Leave `router.owned` empty for unmeasured classes. This is the evidence-based safe decision, not a claim Needle won. |
| Session log torn-write recovery | OPEN | Current reader tolerates a torn final line, but does not repair/truncate it before the next append. Add crash/reopen/append regression and prove the repaired file has no corrupt middle line. |
| File-lock safety | PARTIAL | Cross-process locking exists. Verify paused-live-owner behavior and multi-process stress on Windows and Linux; a filesystem lock's stale-lock policy must not be treated as proven by unit tests alone. |
| BUG-12 semantic retrieval | PARTIAL | Service is loaded when dependencies exist. Still require a model-facing, actor-scoped retrieval tool/section, bounded result count/tokens, provenance, input-guard fencing, and poisoning tests. Do not expose raw facts directly to a model. |
| OpenRouter live provider | OPEN | Perform one opt-in request with an owner-supplied key/model; preserve redacted request metadata and successful response log. No live credentials used in this run. |
| Tauri / 1B.4 | OPEN | Build the real sidecar and app on target Windows machine; record installer size, cold-start time, idle memory and sidecar lifecycle before choosing Tauri. |
| 1B.4 remaining implementation | OPEN | Terminal wizard is still the AppCore client gap. Define and pass its acceptance criteria; do not claim complete from standalone AppCore tests. |

### Commands for the remaining local acceptance work

```sh
# target Windows machine, with Docker and Crabbox configured
crabbox doctor --provider local-container --local-container-runtime docker
HARNESS_CRABBOX_RUNTIME=docker npx tsx scripts/smoke-crabbox.ts

# real Needle wrapper plus real worker; do not set HARNESS_STANDIN
HARNESS_ROUTER_CMD="..." HARNESS_ROUTER_FILES="..." npx tsx scripts/eval-router.ts

# real run labels: use the actual SessionLog directory from the profile runs
npx tsx scripts/eval-calibrate.ts <logDir> labels.json

# OpenRouter: explicit owner credential and exact model id; consumes API quota
HARNESS_LIVE_OPENROUTER=1 OPENROUTER_API_KEY=... OPENROUTER_MODEL=... npx vitest run test/openai-compatible.test.ts

# after a >=20-run independently labelled dataset is committed
npm run eval -- <logDir> labels.json
```

### Validation performed in this repository edit

GitHub source inspection only. No TypeScript compiler, Vitest, Windows, Docker, Crabbox, Ollama/Needle, OpenRouter, or Tauri process was available through the repository connector. Do not interpret this PR's documentation update as a passing test run.

## 2026-11-08 S0 transport disposition and independent closeout continuation

**Current S0 / ARCH-01 disposition: PENDING-ENVIRONMENT.** This entry supersedes older S0 status labels where they conflict with the newest attempt.

- Pinned local-container image warmup succeeded; Crabbox reported a ready lease and SSH endpoint. Inspect succeeded and Docker showed the container running.
- crabbox run failed before the requested in-container command executed while preparing the private WSL SSH transport file. The error reported an empty path to create/chmod. Exact root cause is not isolated.
- crabbox stop succeeded and the lease disappeared from the provider list.
- Exit-code 0/7 execution, Harness real-sandbox acceptance, host-file isolation, and S1 orphan recovery remain unverified.
- Full incident chronology and evidence boundaries: [S0 / ARCH-01 transport incident report](evidence/S0-ARCH-01-TRANSPORT-INCIDENT-REPORT-2026-11-08.md). Concise current evidence: [S0 transport status](evidence/S0-TRANSPORT-2026-11-08.md).

**Work order:** pause S0 transport debugging at the owner's request. Continue independent S3, S5, S6 preparation, S7 review/implementation where prerequisites permit, and S8 documentation reconciliation. S1 real acceptance remains dependent on S0. S4 live end-to-end acceptance must not be claimed without its sandbox/provider evidence.

**Documentation branch:** work/continue-independent-closeout-2026-11-08, based on main fb4f2fa27570254c62a5cdfc16e392a77ff7c875 (PR #20 merged). This entry is a status correction and work-order change, not a test result.

## 2026-11-08 independent work started: S5 license inventory

The independent S5 pass began while S0 remains paused.

- Refreshed THIRD_PARTY_LICENSES.md from the current committed package-lock.json on this branch. The current lockfile has 157 package entries, not the 180 entries recorded in the prior 2026-11-05 inventory.
- Current full lockfile metadata counts: MIT 123, Apache-2.0 15, BSD-3-Clause 2, ISC 2, MPL-2.0 12, 0BSD 1, Unlicense 1, and UNDECLARED 1.
- A static traversal from root runtime dependencies through resolved dependencies, optional dependencies, and present peer dependencies reached 59 lockfile entries. This is a lockfile graph estimate, not an exact shipped-artifact inventory.
- json-bignum@0.0.3 remains UNDECLARED in lockfile metadata; its upstream LICENSE is MIT and that notice must be retained if distributed.
- Remaining S5 work: inspect the exact production packaging closure and generated notice bundle; no release artifact was available in this repository review. Qwen artifact revision and per-file hashes are also still absent. The existing verifier currently accepts one artifact file per invocation; no model weights were downloaded or verified in this pass.

This is a source-backed inventory refresh, not a legal review or release clearance.

## 2026-11-08 continuation PR validation and S7 source review

PR #21's latest head c704bbddaf2497d600479fb0ff4dc8d08234eb4b completed GitHub Actions CI run #302 with conclusion **success**. This validates the repository's configured CI for that head; it does not run Docker/Crabbox, a live model, or a real embedding provider.

S7 source review:
- `search_code` output is fenced with a per-call random nonce and explicitly labeled project data; `test/retrieval-tools.test.ts` checks nonce uniqueness, matching open/close markers, forged-marker attempts, and secret exclusion.
- `InputGuard` adds a second nonce fence to successful tool results except tools that fence themselves; suspicious instruction patterns are logged as `input.flagged`. Its own source describes detection as heuristic, not prevention.
- Policy gates remain the action enforcement layer, independent of retrieved text. A fence is not proof that a live model obeys it.
- Existing tests exercise formatting and deterministic behavior, not whether a live model refuses an injected instruction. No accepted live embedding-provider or poisoning run is recorded.

Disposition remains **S7 PARTIAL / REAL ACCEPTANCE OPEN**. Next gate: run the documented real embedding provider, then a controlled poisoning task with a harmless canary instruction and a forbidden side-effect attempt; retain prompt, retrieved content, model response, tool/policy events, and final filesystem diff. Do not claim success from the fence unit tests alone.

## 2026-11-08 S6 evaluation source review

Reviewed the current D-109 implementation and evidence template.

- `docs/evidence/EVAL-10.md` correctly records BLOCKED-HUMAN and states that no sessions or labels are fabricated.
- The tracked root `labels.json` has only three `good` labels. It does not meet the minimum of 10 distinct matched real sessions and has no `bad` class.
- `commit-eval-labels.ps1` stages labels, hashes the Git index blob (not raw worktree bytes), commits labels plus sidecar, and checks that the committed working copy is clean.
- `eval-calibrate.ts` verifies committed label provenance before reading labels or emitting scorer output; it requires at least 10 labels (20 when 20+ sessions are available) and both classes. Agreement is reported, not used as a pass/fail cutoff, consistent with D-109.
- No live sessions were generated or labels changed during this review.

Disposition remains **S6 BLOCKED-HUMAN**. Next action requires genuine model-driven sessions and owner-assigned labels, not code changes or synthetic fixtures.

## 2026-11-08 S5 provenance workflow clarification

The model provenance template previously described an immutable commit-or-tag, while the validator accepts only a full 40- or 64-character Git commit hash. The placeholder now states that exact format. The current verifier hashes one artifact file per invocation; for a sharded model, the plan now requires one provenance JSON per file and independent comparison against pinned Hugging Face Git-LFS object IDs (or another trusted checksum source). No model files were downloaded or hashed. S5 remains PARTIAL.

## 2026-11-08 S3 acceptance path source verification

Verified the manual S3 procedure against the current CLI and policy implementation:
- `harness code` accepts `--provider ollama`, `--model`, and `--sandbox none`. With sandbox none, command tools are withheld and file tools remain gated; there is no host-command fallback.
- The policy path-criticality signal assigns `package.json` score 0.5, below the default 0.8 threshold, so a real-fs-write request should be held even if the model reports high confidence.
- The built-in `credential-path` deny rule explicitly matches `.env.prod` and `.env.production`; it is a hard denial and cannot be overridden.
- The remaining acceptance is owner-run: terminal approval/denial plus JSONL verification of `policy.decision`, `approval.pending`, and `approval.resolved` for the held write, and hard-deny evidence for the secret read.

No live model was run. S3 remains PARTIAL pending that owner-run session.


## 2026-11-08 S3 governed CLI integration regression

PR #22 adds a deterministic end-to-end test through `runCodeTask`: the package-manifest write is held at path-criticality 0.5, the scripted terminal denial is recorded, and `.env.production` is hard-denied by `credential-path` without an approval prompt. The fixture remains unchanged and `--sandbox none` keeps command execution unavailable. GitHub Actions run #321 passed on Ubuntu and Windows for final tested head `cf435b377721cece23fea08fd4d86b11f5576282` (npm ci, typecheck, lint, and full test suite). This does not replace the owner-run Ollama session. S3 remains PARTIAL.


## 2026-11-09 S3 live Ollama acceptance update

Owner-run tests used the installed `llama3.2:3b` model. The hard-deny portion passed: session `942f90bb-c51f-4c3e-bbd2-ef2dfb98d915` records `.env.production` denied by `credential-path` with no approval request. The package manifest remained unchanged.

The write-approval portion has **not** passed. One run supplied an invalid `edit_file` argument shape and received a tool validation error. Another planner run selected `search_code` for the explicit `package.json` path, passed an empty path, and never attempted `edit_file`. No policy hold or approval events were generated in that run.

PR #22 now adds planner guidance and input-schema context for exact-path tool selection, with a regression test. Keep S3 PARTIAL until fresh CI passes and a live `llama3.2:3b` session records a valid manifest edit call, `policy.decision: hold`, terminal approval denial, and the credential-path hard deny. No large model is required or planned.


## 2026-11-09 S3 planner normalization correction

A further owner-run `llama3.2:3b` session showed that planner prompt guidance alone did not prevent an exact-path task from being decomposed into an unnecessary `search_code` step while omitting the explicitly requested `edit_file` call. The read itself succeeded; `package.json` remained unchanged; no write-policy or approval event was reached.

PR #22 now adds deterministic normalization for the narrow case where the task contains an exact file path and explicitly names the offered tools to call. The effective plan becomes one ordered subtask with those positively requested tools. Negated tool mentions are excluded. The original model plan and effective plan are retained in the `plan.normalized` audit event. A regression test covers the observed planner output and verifies that prohibited `write_file` and `run_command` mentions are not granted.

This correction is not live acceptance evidence. **S3 remains PARTIAL** until fresh CI passes and a live `llama3.2:3b` session records a valid `edit_file` call, a path-criticality `policy.decision: hold`, terminal approval denial, and the `.env.production` `credential-path` hard denial. No large model is required or planned.
