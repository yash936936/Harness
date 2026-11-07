# Prototype audit closeout

Date: 2026-11-07  
Repository: `yash936936/Harness`  
Scope: working prototype only. Statuses below distinguish committed code, CI, and external acceptance evidence. A green test suite never stands in for a real sandbox, provider, desktop runtime, or human-labelled dataset.

| ID | Status | Evidence path | Owner command / remaining action |
|---|---|---|---|
| ARCH-01 | BLOCKED-HARDWARE | `src/bundles/tools-local/index.ts`, `src/profiles/profile-coding.ts`, `src/cli/code.ts`, `docs/evidence/PHASE-5.1.md` | On Windows with Docker Desktop + Crabbox: `crabbox doctor --provider local-container --local-container-runtime docker`; then `$env:HARNESS_REAL_CRABBOX="1"; npm run test:real-sandbox 2>&1 | Tee-Object docs/evidence/PHASE-5.1.raw.txt`. No host fallback exists; command tool is withheld until doctor succeeds. |
| S2 | Closed | PR #11, PR #12, GitHub Actions run #63 | Both PRs are merged; run #63 passed npm ci, typecheck and tests on Ubuntu and Windows. |
| S1 | BLOCKED-HARDWARE | `test/sandbox-real.test.ts`, `docs/evidence/PHASE-5.1.md` | After S0 passes, verify host sentinel absence and kill Harness mid-lease; confirm restart reaps the orphan. Add reaper code/test if absent. No evidence is claimed. |
| S3 | Partial | `src/cli/code.ts`, `test/code-cli.test.ts`, session log | Governed command and scripted test exist. Owner must run a manual task showing a gated write, hard-blocked action, approval/deny, and corresponding session-log events. |
| 5.1 | BLOCKED-HARDWARE | `scripts/real-sandbox.mjs`, `test/sandbox-real.test.ts`, `docs/evidence/PHASE-5.1.md` | Same real Docker/Crabbox command above. Fakes and regular Vitest tests do not prove a container ran. |
| 5.2 | DEFERRED | `src/bundles/sandbox-cubesandbox/`, `docs/decisions.md` (D-024) | Deferred by scope reset. Only reopen on x86_64 Linux with KVM: run the CubeSandbox smoke script with credentials and preserve raw output. |
| ENG-04 | Partial | `LICENSE`, `THIRD_PARTY_LICENSES.md`, `package-lock.json`, `docs/decisions.md` (D-105) | Before distribution, rebuild the exact production bundle and verify included notices: `npm ci`, then `npm run license:inventory`; inspect production dependency closure and retain the json-bignum MIT text in shipped notices. THIRD_PARTY_NOTICES and package-shipped NOTICE verification remain open. Apache-2.0 covers original repo work, not dependencies. |
| ENG-08 | Partial | `docs/decisions.md` (D-104, D-105), `scripts/verify-model-artifact.ts`, `scripts/evidence/model-provenance.template.json` | Before any model artifact distribution: pin an immutable Qwen2.5-Coder-7B-Instruct revision, download artifact, write provenance JSON with model/revision/source/SHA-256, then `npx tsx scripts/verify-model-artifact.ts <artifact-file> <provenance.json>`. Qwen 3B remains excluded from commercial distribution absent written permission. No weights are in this repository. |
| 6.2 | BLOCKED-HUMAN | `scripts/eval-calibrate.ts`, `scripts/eval-calibrate-validation.ts`, `scripts/eval-label-provenance.ts`, `scripts/commit-eval-labels.ps1`, `test/eval-label-provenance.test.ts`, D-109 | Generate at least 10 distinct real model sessions (20+ if at least 20 are collected); the owner labels them with both classes, hashes and commits labels before scorer output. The CLI now refuses to score before this gate. No minimum agreement percentage. No fabricated sessions or labels. |
| 6.4 | BLOCKED-HUMAN | `scripts/eval-calibrate.ts`, `docs/evidence/EVAL-10.md`, D-109 | After at least 10 matched labels (20+ if already collected) are committed with SHA-256, run `npm run eval -- <session-log-dir> <labels.json>`. Report raw agreement, class counts and confusion table as **prototype-grade, not calibrated**; no agreement cutoff. |
| ARCH-02 | Partial | `src/bundles/router/`, `src/profiles/profile-coding.ts`, `docs/decisions.md` (D-100) | Safe default is retained (`router.owned` empty for unmeasured classes). Need the actual Needle runtime and frozen-suite comparisons before granting ownership: `npx tsx scripts/eval-router.ts` plus real Needle wrapper command documented by the script. |
| Session logs | PENDING-CI (prior implementation passed run #63) | `src/bundles/session-log/`, `test/session-log.test.ts`, `test/session-log-multiprocess.test.ts`, `test/fixtures/append-worker.ts`, `docs/debug.md` (DBG-072) | This branch adds payload snapshotting and valid-final-record newline recovery tests. Require fresh Ubuntu/Windows CI before accepting the updated code. This is not a hardware power-loss durability claim. |
| File locking | PARTIAL (Windows paused-holder verified) | `src/util/filelock.ts`, `test/session-log-multiprocess.test.ts`, `test/fixtures/append-worker.ts`, `scripts/test-windows-paused-lock.ps1`, `docs/evidence/WINDOWS-LOCK-TAURI-1B4.md` | Windows PsSuspend v1.09 acceptance passed: 15/15 tests, including the OS-suspended live-holder regression. Remaining: run stress tests on each supported target filesystem/platform and retain raw evidence; this Windows run is not a power-loss durability claim. |
| BUG-12 | Partial | `src/bundles/memory/`, `src/profiles/profile-coding.ts`, `test/`, `docs/decisions.md` (D-101), `docs/debug.md` (DBG-075, DBG-081, DBG-083) | Semantic source/tag metadata is redacted on write and read; real model retrieval quality/poisoning remains unmeasured. Run on a configured embedding/vector backend with real sessions and preserve results; no fake-provider pass closes this gate. |
| Ollama | BLOCKED-HARDWARE | `src/cli/code.ts`, `docs/evidence` | Run one full governed coding task through `harness code` using a real installed Ollama model after S0; preserve the session log and verify the target project's tests. The timeout option alone is not live-task acceptance. |
| OpenRouter | BLOCKED-KEY | `src/cli/code.ts`, `scripts/smoke-openrouter.ts`, `docs/evidence/OPENROUTER.md` | Set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` only in env; run `HARNESS_LIVE_OPENROUTER=1 npm run smoke:openrouter`, then one full `npm run harness -- code --provider openrouter --model "$OPENROUTER_MODEL" "<task requiring a gated approval>"`. Scan stdout/session logs/committed files for seeded key material without printing it. |
| Tauri | DEFERRED | `app/desktop/bench/hello-tauri/`, `app/desktop/bench/README.md`, `docs/decisions.md` (D-048, D-104) | Provisional only. Reopen after target 8 GB Windows machine is available: `cd app/desktop/bench; npm install; npm run measure:electron; npm run measure:tauri`; capture installer size, five-run cold start and idle working set with Node core. No measurement was taken here, therefore no Electron fallback decision is justified. |
| 1B.4 | Partial | `app/desktop/bench/`, `src/cli/code.ts`, `docs/decisions.md` (D-104) | Desktop shell with real core, authenticated loopback JSON-RPC, three screens and replay is not implemented. Do not claim the benchmark hello-worlds are a desktop product. |

## What is actually closed

- The governed CLI entry point is present: `npm run harness -- code`. It boots the coding profile, absolute current-directory project root, selected provider, orchestrator, approval callback, and session log. The terminal approval request is explicit, and approve/deny is returned by the terminal IO. The ordinary `run` command remains separate.
- Fail-closed command availability is implemented. Without Docker or when Crabbox doctor fails, `run_command` is excluded and the CLI prints the no-sandbox notice; file tools remain behind their policy gates. There is no host-execution fallback.
- D-106 fixes are present in source and covered by regression tests. D-106 reports the tests failed against old code before passing after the fixes.
- Session-log torn-tail recovery is implemented; the child-process interruption fixture is a process-level regression, not hardware durability proof.
- GitHub Actions run #63 for main commit `e93ff1edff16b9c643eecf54ec2b3985e5829369` passed on Ubuntu and Windows. Both jobs completed `npm ci`, `npm run typecheck`, and `npm test`. CI does not run `npm run lint` as a distinct step. The job summary does not expose detailed Vitest pass/skip totals, so this closeout does not invent them.

- **Phase 6.2/6.4:** the tracked root `labels.json` currently contains only three `good` labels. It fails the D-109 minimum and lacks a `bad` class; it is not accepted as real evaluation evidence.

## Blocked or partial

- **BLOCKED-HARDWARE:** real Crabbox/Docker lease, execution and release; real Needle runtime; Tauri installed-shell and sidecar measurements. Windows OS-suspended live-holder acceptance is now verified; broader target-filesystem/platform stress remains.
- **BLOCKED-KEY:** one live OpenRouter request and one complete governed OpenRouter task because credentials were not available to this run. Ollama full-task acceptance also remains unverified.
- **BLOCKED-HUMAN:** at least 10 genuine model-driven sessions (20+ if already collected) and owner-only labels committed and hashed before scorer output, with both good/bad classes; no agreement percentage is required. The tracked root labels.json has only three good labels, so it does not qualify.
- **Partial:** third-party distribution notice verification, immutable Qwen artifact pin/hash, router comparison/ownership, real-model semantic-memory quality, and the full desktop product.

## Deferred by prototype scope

CubeSandbox, Qdrant, Langfuse, browser tool, Needle router ownership absent measured evidence, multi-user support, Linux/macOS acceptance, additional desktop screens, CI license gate, and install-size/RSS thresholds. Tauri remains provisional under D-048, not selected by fresh measurements.

## Defects and limitations found

The closeout found a recordkeeping defect: earlier status entries cited superseded CI runs. Current main was independently checked at run #63, which passed on Ubuntu and Windows. PR #11 and PR #12 are both merged. Historical older status entries contain stale phase descriptions; they remain historical and are superseded by the newest dated entries. The Windows owner acceptance subsequently ran successfully: PsSuspend v1.09, 15/15 tests passed in 20.66 seconds, including the OS-suspended live-holder case. This follow-up updates that evidence without claiming other external gates. The local `npm ci` attempt during the earlier docs-only closeout timed out; no local lint or test result is claimed here. PR #12's fake-CLI environment test does not close the real Crabbox acceptance gate.


## 2026-11-07 repository-wide review delta

The follow-up review is being developed on branch `audit/repository-wide-review-2026-11-07`. It is not merged or CI-accepted yet.

| Area | Defect found | Change and regression coverage | Remaining acceptance |
|---|---|---|---|
| Session JSONL | Valid final JSON without a trailing newline could be concatenated with the next append | Repair delimiter under the session lock; existing no-newline/torn-tail tests | Fresh CI; no hardware power-loss claim |
| Episodic memory | Same valid-final-record delimiter gap | Repair before append under the episode-store lock; regression test | Fresh CI; no multi-host filesystem claim |
| Egress consent | Concurrent processes could lose read-modify-write updates; special object keys and mutable record references were unsafe | Lock + unique temp file + atomic rename; validate records; defensive copies; null-prototype map; concurrency/special-key tests | Fresh CI; local filesystem assumption inherited from filelock |
| Local file security | Credential denylist missed common cloud/SSH/CLI/Kubernetes/Docker/GCP/Cargo/Terraform locations | Expanded path matcher and read refusal tests | Fresh CI; secret naming patterns cannot identify arbitrary user-defined secret files |
| Code retrieval | Secret globs were incomplete/case-sensitive; configured ripgrep symlink following could surface outside-root content | Case-insensitive exclusions and realpath check for existing match paths; integration fixtures cover credential directories and `--follow` | Fresh CI; retrieval with `includeSecrets: true` remains an explicit opt-in |
| Model provider config | OpenAI-compatible endpoint accepted non-HTTP schemes and URL userinfo | Reject unsupported protocols and embedded credentials; tests added | Fresh CI; no live provider request claimed |
| Evaluation | Custom scorers could return non-finite weights or invalid score/result fields | Validate scorer names, weights, score range and result types; tests added | Fresh CI; real-data evaluation remains blocked under D-109 |
| Label provenance | The evaluator trusted a manual instruction to commit labels before scoring but did not enforce it | New provenance verifier requires tracked, committed, clean labels and a matching SHA-256 sidecar; temp-Git regression tests | Fresh CI; owner must still label genuine sessions independently |
| Async data integrity | Session-log events, episodic episodes, semantic metadata and model prompts could be mutated by callers while queued or awaiting remote consent | Snapshot payloads at API entry; regression tests verify stored/logged/sent values match the original request | Fresh CI |
| Rate limiter | Nested persistent state paths failed before the first daily counter write; date validator only checked a string pattern | Create parent directory before locking; validate real calendar day keys; existing nested-path/corrupt-state tests | Fresh CI |
| Budget persistence | Impossible or future-dated day values could be treated as stale and silently reset daily usage | Validate actual calendar dates and fail closed on future state; document the day file as per-process rather than a cross-process shared quota; tests added | Fresh CI; cross-process request limits remain in RateLimiter |
| Model token budget | Invalid `maxTokens` values (including negative/unbounded Ollama caps) could understate the pre-call token reservation | Require a positive safe integer at the model-call boundary and in the estimator; regression tests assert no logging/provider call | Fresh CI |
| Egress redaction | Registered secrets in JSON property names were not redacted, only values | Redact object keys and values recursively; regression test added | Fresh CI |
| CLI project root | An existing file path passed the existence check and could throw while creating `.harness` | Require an accessible directory before setup; regression test verifies graceful failure | Fresh CI |
| Provider connection probe | Invalid timeout values could throw before the never-throw result contract; caller aborts were misreported as timeouts | Validate positive bounded timeout values and classify caller cancellation separately; tests added | Fresh CI |
| Encrypted credential key | Existing key files were not re-tightened to mode `0600`, and symlinked key paths were accepted | Reapply POSIX mode on read and reject non-regular/symlink key paths; tests added | Fresh CI; Windows ACLs remain platform-managed |
| Model artifact pin | Artifact verifier accepted mutable revision names such as `main` despite the immutable-pin requirement | Shared provenance validator requires full 40/64-hex commit hash and SHA-256; unit tests added | Fresh CI; actual Qwen revision/files/hashes still owner/network evidence |
| Policy gate build | Existing invalid-signal branch referenced its decision base before declaration; the new lint gate also found an unused helper | Initialize decision snapshot before validating signals; validate persisted day keys with the helper | Fresh CI |

The audit branch also adds a dedicated CI lint step (`npm run lint`) in addition to typecheck and tests. No local compiler/test execution was available through the repository connector. Do not merge until the latest branch commit passes Ubuntu and Windows CI.

This work does not run S0. ARCH-01 remains BLOCKED-HARDWARE until the owner runs the real Windows + Docker + Crabbox lease/run/release acceptance and preserves the raw output.

## Owner acceptance commands (Windows PowerShell 5.1)

Run each command on its own line. Replace angle-bracket placeholders locally; do not paste secrets into chat, logs, or files.

- **ARCH-01 / S0:**
  ~~~powershell
  npm ci
  crabbox --version
  docker version
  crabbox doctor --provider local-container --local-container-runtime docker
  $env:HARNESS_REAL_CRABBOX = "1"
  npm run test:real-sandbox 2>&1 | Tee-Object docs/evidence/PHASE-5.1.raw.txt
  docker ps -a
  ~~~
- **S1:** no valid acceptance command exists yet. The repository has no orphan-lease reaper and no host-sentinel regression test. Implement those first; then add a deterministic real-sandbox acceptance script and record docs/evidence/ARCH-01.md. Do not substitute npm test or S0's lease test.
- **S3:**
  ~~~powershell
  npm run harness -- code --provider ollama --model "<installed-model-tag>" "Create a small file change that requires approval, attempt one deny-listed action, and wait for my approval before writing. Record the approval and denial in the session log."
  ~~~
- **S4 / Ollama:**
  ~~~powershell
  npm run harness -- code --provider ollama --model "<installed-model-tag>" "Fix one real bug in this project and run its tests."
  ~~~
- **S4 / OpenRouter:**
  ~~~powershell
  $env:OPENROUTER_API_KEY = "<set locally; do not paste>"
  $env:OPENROUTER_MODEL = "<exact free-tier model id>"
  npm run smoke:openrouter
  npm run harness -- code --provider openrouter --model "$env:OPENROUTER_MODEL" "Fix one real bug in this project and run its tests."
  ~~~
- **ENG-04:**
  ~~~powershell
  npm ci
  npm run license:inventory
  ~~~
  Inspect the production dependency closure and verify that shipped notices contain the required json-bignum text; this is not yet automated.
- **ENG-08:**
  ~~~powershell
  npx tsx scripts/verify-model-artifact.ts <artifact-file> <provenance.json>
  ~~~
  The artifact and provenance must first be downloaded/pinned at an immutable revision; the command alone does not create provenance.
- **6.2 / 6.4:** after at least 10 genuine sessions are independently labelled, both classes are present, and labels plus SHA-256 are committed:
  ~~~powershell
  powershell -ExecutionPolicy Bypass -File scripts/commit-eval-labels.ps1 -LabelsPath <path-to-labels.json>
  npm run eval -- <session-log-dir> <labels.json>
  ~~~
  The commit script must run before any scorer output is generated or viewed. Do not use the three-entry root placeholder.
- **ARCH-02:** configure the real Needle wrapper and frozen suite, then run:
  ~~~powershell
  npx tsx scripts/eval-router.ts
  ~~~
- **File-lock stress:**
  ~~~powershell
  powershell -ExecutionPolicy Bypass -File scripts/test-windows-paused-lock.ps1
  ~~~
  Existing 15/15 paused-holder evidence is already recorded; this rerun is for additional target-filesystem stress, not a replacement claim.
- **BUG-12 / real embedding:**
  ~~~powershell
  $env:HARNESS_OLLAMA_EMBED_MODEL = "nomic-embed-text"
  npx tsx scripts/smoke-phase3.ts
  ~~~
  This does not replace the missing poisoned-content acceptance. There is currently no real-provider poisoning acceptance script.
- **Tauri benchmark:**
  ~~~powershell
  powershell -ExecutionPolicy Bypass -File scripts/tauri-benchmark.ps1
  ~~~
- **1B.4 desktop product:** no acceptance command exists because the desktop shell, authenticated loopback RPC, screens, and replay product are not implemented. The hello-world benchmarks are not the product.


## 2026-11-07 final audit validation

- PR #15 merged as d07e191548c2fc3f6bc56192a27824af38a177d0.
- Audit branch commit 0e9ad7a5585d73b96494d990b5be90e16dc4f036 passed npm ci, typecheck, lint and tests on both Ubuntu and Windows in Actions run #237.
- The merge commit's own main-branch workflow run #238 was still running at documentation time; it must also pass before the audit is considered fully green on main.
- S0 was not run. ARCH-01 remains BLOCKED-HARDWARE until the owner executes the exact PowerShell acceptance command in this document. S1 remains open because the host-sentinel test and orphan-lease reaper are not implemented.
- All five automated review threads on PR #15 were replied to and resolved.
