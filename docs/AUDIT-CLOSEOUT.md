## 2026-11-10 D-110 disposition: S0 permanent hold; S3 evidence boundary

This dated disposition supersedes the older S0/S1 status rows below.

| ID | Current disposition | Evidence / boundary |
|---|---|---|
| S0 / ARCH-01 | **PERMANENT-HOLD** | Owner decision D-110. Historical WSL/Crabbox transport failure remains unresolved. No further probes, retries, workarounds, or host fallback. This is not a pass or technical fix. Reopen only through an explicit superseding owner decision. |
| S1 | **DEFERRED-S0-HOLD** | Real host-sentinel/orphan-reaper acceptance depends on S0 and is not pursued under D-110. Fake-backed tests do not close it. |
| S3 | **PARTIAL: implementation/CI passed; live acceptance open** | Independent of S0. Requires the 3B-only live session JSONL and clean `package.json` diff, with all event checks in `docs/BUILD-PLAN.md`. Do not close from CI or an uninspected session ID. |

PR #41 is merged as `778ab63fb69f3ebf9cc916643b50f4ae0f214ff8`; GitHub Actions run #403 passed typecheck, lint, and tests on Windows and Ubuntu. The owner's OpenRouter smoke output passed, but the full governed OpenRouter coding task and target-project tests remain separate S4 requirements.

## 2026-11-10 S3 post-sequence finalization fix merged

- PR #38 (`fix(agent-loop): stop repeated post-sequence tool retries`) merged into `main` as `51486ad0dfbad219d6118e2fe16d53a44fcaee56`. The exact PR head `ae4ea4b3cb8ed5b46c4e469d4bf6d114cb297bb4` passed GitHub Actions run #394 on both Ubuntu and Windows: install, typecheck, lint, and full tests.
- After the required ordered tool sequence completes, the first unexpected provider-emitted tool call is rejected and the loop returns a deterministic non-empty final response without another model request. The regression test proves repeated extra calls do not trigger repeated model requests or tool execution.
- This closes the implementation/CI defect found in the previous `qwen2.5-coder:3b-instruct` trace. It does **not** close live S3 acceptance.
- **S3 remains PARTIAL** until the owner runs the documented acceptance once with `qwen2.5-coder:3b-instruct`, preserves the session JSONL, and separately confirms `git diff HEAD --exit-code -- package.json` exits 0. Review the normalized camelCase edit arguments and numeric confidence, path-criticality-limited hold, explicit approval denial, `.env.production` credential-path hard denial without approval or disclosure, ordered calls, and non-empty final response.
- Do not use a 7B or larger model for this acceptance. S0 remains on hold and is unrelated.

# Prototype audit closeout

Date: 2026-11-10  
Repository: `yash936936/Harness`  
Scope: working prototype only. Statuses below distinguish committed code, CI, and external acceptance evidence. A green test suite never stands in for a real sandbox, provider, desktop runtime, or human-labelled dataset.

| ID | Status | Evidence path | Owner command / remaining action |
|---|---|---|---|
| ARCH-01 | BLOCKED-HARDWARE | `src/bundles/tools-local/index.ts`, `src/profiles/profile-coding.ts`, `src/cli/code.ts`, `docs/evidence/PHASE-5.1.md` | On Windows with Docker Desktop + Crabbox: `crabbox doctor --provider local-container --local-container-runtime docker`; then `$env:HARNESS_REAL_CRABBOX="1"; npm run test:real-sandbox 2>&1 | Tee-Object docs/evidence/PHASE-5.1.raw.txt`. No host fallback exists; command tool is withheld until doctor succeeds. |
| S2 | Closed | PR #11, PR #12, GitHub Actions run #63 | Both PRs are merged; run #63 passed npm ci, typecheck and tests on Ubuntu and Windows. |
| S1 | BLOCKED-HARDWARE | `test/sandbox-real.test.ts`, `docs/evidence/PHASE-5.1.md` | After S0 passes, verify host sentinel absence and kill Harness mid-lease; confirm restart reaps the orphan. Add reaper code/test if absent. No evidence is claimed. |
| S3 | PARTIAL (implementation and CI passed; live session incomplete) | `src/bundles/agent-loop/index.ts`, `src/cli/code.ts`, `test/agent-loop.test.ts`, `docs/BUILD-PLAN.md`, latest owner-run JSONL | PR #35 hides tools after the required sequence; PR #35 CI #387 and PR #36 merge CI #390 passed on Ubuntu and Windows. Latest 3B trace verified the held write, explicit denial, and credential-path hard denial, but the model retried tools and returned empty final text. Rerun the updated 3B-only procedure in `docs/BUILD-PLAN.md`; verify non-empty final text and `git diff HEAD --exit-code -- package.json`. No S0/Docker dependency for this file-tool gate. |
| 5.1 | BLOCKED-HARDWARE | `scripts/real-sandbox.mjs`, `test/sandbox-real.test.ts`, `docs/evidence/PHASE-5.1.md` | Same real Docker/Crabbox command above. Fakes and regular Vitest tests do not prove a container ran. |
| 5.2 | DEFERRED | `src/bundles/sandbox-cubesandbox/`, `docs/decisions.md` (D-024) | Deferred by scope reset. Only reopen on x86_64 Linux with KVM: run the CubeSandbox smoke script with credentials and preserve raw output. |
| ENG-04 | Partial | `LICENSE`, `THIRD_PARTY_LICENSES.md`, `THIRD_PARTY_NOTICES/json-bignum-MIT.txt`, `package-lock.json`, `docs/decisions.md` (D-105) | The json-bignum MIT notice is now retained in the repository. The lockfile still says UNDECLARED; upstream LICENSE and independent package metadata identify MIT. Before distribution, verify exact production dependency closure and actual package output, then confirm the notice is shipped. Exact version-tag license provenance remains unverified. Apache-2.0 covers original repo work, not dependencies. |
| ENG-08 | Partial | `docs/evidence/qwen2.5-coder-7b-instruct/`, `scripts/verify-model-artifact.ts`, `scripts/model-artifact-provenance.ts`, D-104, D-105 | Pinned Qwen2.5-Coder-7B-Instruct to immutable Hugging Face revision `7b148ce7a59a361780846419d31d271537addf81`; recorded upstream SHA-256 and per-file manifests for all four Safetensors shards. Owner must download and verify each shard locally, inventory tokenizer/configuration files, and retain model notices before distribution. No weights are in this repository. Qwen 3B remains excluded from commercial distribution absent written permission. |
| 6.2 | BLOCKED-HUMAN | `scripts/eval-calibrate.ts`, `scripts/eval-calibrate-validation.ts`, `scripts/eval-label-provenance.ts`, `scripts/commit-eval-labels.ps1`, `test/eval-label-provenance.test.ts`, D-109 | Generate at least 10 distinct real model sessions (20+ if at least 20 are collected); the owner labels them with both classes, hashes and commits labels before scorer output. The CLI now refuses to score before this gate. No minimum agreement percentage. No fabricated sessions or labels. |
| 6.4 | BLOCKED-HUMAN | `scripts/eval-calibrate.ts`, `docs/evidence/EVAL-10.md`, D-109 | After at least 10 matched labels (20+ if already collected) are committed with SHA-256, run `npm run eval -- <session-log-dir> <labels.json>`. Report raw agreement, class counts and confusion table as **prototype-grade, not calibrated**; no agreement cutoff. |
| ARCH-02 | Partial | `src/bundles/router/`, `src/profiles/profile-coding.ts`, `docs/decisions.md` (D-100) | Safe default is retained (`router.owned` empty for unmeasured classes). Need the actual Needle runtime and frozen-suite comparisons before granting ownership: `npx tsx scripts/eval-router.ts` plus real Needle wrapper command documented by the script. |
| Session logs | CI-PASSED (2026-11-07 run #237, Ubuntu + Windows) | `src/bundles/session-log/`, `test/session-log.test.ts`, `test/session-log-multiprocess.test.ts`, `test/fixtures/append-worker.ts`, `docs/debug.md` (DBG-072) | Payload snapshotting and valid-final-record newline recovery tests are included. The merged audit head passed typecheck, lint, and tests on Ubuntu and Windows in GitHub Actions run #237. This is not a hardware power-loss durability claim. |
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

The follow-up review was developed on `audit/repository-wide-review-2026-11-07` and merged through PR #15 on 2026-11-07. The audit baseline passed Ubuntu and Windows typecheck, lint, and tests in run #237. The DBG-085 follow-up and reconciled documentation passed on both platforms in run #247 at `2c846ee9b9dbbef9ef9a478d17b8f02f34c98587`.

| Area | Defect found | Change and regression coverage | Remaining acceptance |
|---|---|---|---|
| Session JSONL | Valid final JSON without a trailing newline could be concatenated with the next append | Repair delimiter under the session lock; existing no-newline/torn-tail tests | Fresh CI; no hardware power-loss claim |
| Episodic memory | Same valid-final-record delimiter gap | Repair before append under the episode-store lock; regression test | Fresh CI; no multi-host filesystem claim |
| Egress consent | Concurrent processes could lose read-modify-write updates; special object keys and mutable record references were unsafe | Lock + unique temp file + atomic rename; validate records; defensive copies; null-prototype map; concurrency/special-key tests | Fresh CI; local filesystem assumption inherited from filelock |
| Local file security | Credential denylist missed common cloud/SSH/CLI/Kubernetes/Docker/GCP/Cargo/Terraform locations | Expanded path matcher and read refusal tests | Fresh CI; secret naming patterns cannot identify arbitrary user-defined secret files |
| Code retrieval | Secret globs were incomplete/case-sensitive; configured ripgrep symlink following could surface outside-root content | Case-insensitive exclusions and realpath check for existing match paths; integration fixtures cover credential directories and `--follow` | Fresh CI; retrieval with `includeSecrets: true` remains an explicit opt-in |
| Model provider config | OpenAI-compatible endpoint accepted non-HTTP schemes and URL userinfo; governed OpenRouter CLI allowed cleartext HTTP credential transport (DBG-085) | Reject unsupported protocols and embedded credentials in the adapter; require HTTPS in the OpenRouter CLI; regressions added | DBG-085 passed typecheck, lint, and tests on Ubuntu and Windows in GitHub Actions run #247 at `2c846ee9b9dbbef9ef9a478d17b8f02f34c98587`. No live provider request claimed |
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
| Egress metadata and provider errors | Hot-memory source metadata, episodic legacy records, and provider transport errors could expose registered secrets or endpoint paths (DBG-081..083) | Redact hot and episodic metadata on read/write; remove raw provider error/path details; regressions added | CI passed on both platforms in run #237 |
| Consent store symlink | Persisted egress consent could follow a symlink and trust an unrelated target (DBG-084) | Require a regular file, use `O_NOFOLLOW` where supported, and verify descriptor identity; regression added | CI passed on both platforms in run #237 |
| Policy gate build | Existing invalid-signal branch referenced its decision base before declaration; the new lint gate also found an unused helper | Initialize decision snapshot before validating signals; validate persisted day keys with the helper | CI passed on both platforms in run #237 |

The audit branch added a dedicated CI lint step (`npm run lint`) in addition to typecheck and tests. The audit PR was merged on 2026-11-07. The merged audit baseline (`0e9ad7a5585d73b96494d990b5be90e16dc4f036`) passed both platforms in run #237. The subsequent DBG-085 fix and its regression tests at `2c846ee9b9dbbef9ef9a478d17b8f02f34c98587` passed Ubuntu and Windows in run #247, including typecheck, lint, and tests. The documentation was then reconciled on main. This validates automated checks only; it does not close hardware, human-labelled data, live-provider, distribution, or desktop acceptance gates.

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


## 2026-11-08 automated test evidence

The owner reported a local Windows `npm test` result: 56 test files passed, 1 skipped; 1,182 tests passed, 22 skipped; zero failures; 64.00 seconds. Evidence summary: `docs/evidence/TEST-SUITE-2026-11-08.md`. This is not a new CI run and does not close real-environment gates.

- Automated tests: PASS for this reported run.
- S0 / ARCH-01: BLOCKED-HARDWARE. The real Crabbox/Docker test file was skipped.
- S1: OPEN. The existing sentinel check is inside the opt-in real test. The provider's `finally` release is not crash recovery; no orphan lease reaper or process-death acceptance has been demonstrated.
- Local working-tree state: NOT VERIFIED by GitHub-side documentation changes. Preserve local modifications and inspect the working tree before syncing.

## 2026-11-08 status correction: S0 / ARCH-01 remains pending

The earlier table is historical; the newest attempt is recorded here and supersedes its older S0 wording.

| ID | Current status | Latest evidence | Remaining gate |
|---|---|---|---|
| ARCH-01 / S0 | **PENDING-ENVIRONMENT** | Pinned-image warmup and inspect succeeded; Docker container was running. crabbox run failed before workload execution while writing the private WSL SSH transport file (empty path). Stop succeeded and lease disappeared. | Isolate WSL private-file argument handoff, then pass no-sync run, synced run, exit codes 0 and 7, Harness real-sandbox test, release and clean container inventory. |
| S1 | **BLOCKED BY S0 / OPEN** | No accepted orphan-recovery run. | After S0, prove host sentinel absence and ownership-safe orphan recovery after process death. |
| S3 | Partial | Governed CLI and scripted policy tests exist. | Owner-run manual acceptance with a held write, a hard-blocked credential path, terminal approval/denial and matching session-log events. |
| S4 | Open | Provider adapters and smoke paths exist. | Full governed coding tasks on live OpenRouter and Ollama with logs and target-project tests. |
| S5 | Partial | Lockfile inventory and model artifact verifier exist. | Verify exact production dependency closure and shipped notices; pin/download exact Qwen 7B artifact and verify per-file SHA-256. |
| S6 | Blocked-human | D-109 label provenance gate exists. | At least 10 genuine sessions, both labels, owner labels committed and hashed before scorer output. |
| S7 | Partial | Semantic memory and scripted tests exist. | Real embedding-provider run and separate poisoning acceptance proving injected instructions are fenced and not followed. |
| S8 | Open | Audit docs exist. | Reconcile every row against committed evidence after independent gates are run or explicitly retained as blocked/deferred. |

Detailed conversation-based incident history: [S0 / ARCH-01 transport incident report](evidence/S0-ARCH-01-TRANSPORT-INCIDENT-REPORT-2026-11-08.md). This documentation update does not claim any new runtime test. The owner requested pausing S0 transport debugging while independent work continues. S1 remains dependent on S0; do not claim it passed.

## 2026-11-08 independent S5 work started

The lockfile license inventory was refreshed from the current package-lock.json on the continuation branch. It now records 157 lockfile package entries (previously documented as 180 on 2026-11-05), with counts MIT 123, Apache-2.0 15, BSD-3-Clause 2, ISC 2, MPL-2.0 12, 0BSD 1, Unlicense 1, and UNDECLARED 1. A separate static dependency-graph traversal from root runtime dependencies reaches 59 entries when resolved dependencies, optional dependencies, and present peer dependencies are followed.

This refresh corrects the metadata snapshot only. It does not establish the exact contents of a shipped artifact or create a complete notice bundle. json-bignum@0.0.3 remains without lockfile license metadata; its upstream repository's MIT LICENSE is recorded as a notice requirement. ENG-04 remains PARTIAL until the exact production package is built and its included dependency notices are checked. ENG-08 remains PARTIAL until the exact Qwen 7B artifact revision and SHA-256 values are recorded and verified.

## 2026-11-08 S7 source review update

Current code and tests establish deterministic retrieval-output fencing, not live-model resistance to poisoning. `search_code` snippets use per-call random CODE/END nonces and are explicitly marked as untrusted project data. InputGuard adds a nonce fence and heuristic instruction scan to successful tool results that do not fence themselves. Its own code states that this is not prevention. The policy gate remains the independent action-control layer.

Existing `test/retrieval-tools.test.ts` and `test/input-guard.test.ts` cover formatting, nonce uniqueness, forged markers, and instruction-pattern flags. They do not establish that a live model obeys the fence. S7 remains PARTIAL until a real embedding provider and controlled live-model poisoning run produce inspectable evidence. No code defect was confirmed in this source review.

## 2026-11-08 S6 D-109 source review

D-109's code path is present: the PowerShell helper hashes the staged Git blob, commits the labels and sidecar, and the scorer verifies the committed bytes and clean working copy before producing scorer output. The evaluator validates labels against available session IDs and requires 10 matched labels (20 if 20+ sessions are available) with both good and bad classes. Agreement is reported but is not a pass/fail threshold.

The tracked labels file currently contains only three good labels. No genuine 10-session corpus or both-class human labels are recorded. S6 remains BLOCKED-HUMAN; no synthetic labels or sessions were generated.

## 2026-11-08 S5 provenance template alignment

The model provenance template's revision placeholder now matches the validator, which accepts only a full 40- or 64-character Git commit hash. The current verifier hashes one file per invocation; for sharded model weights, record one provenance JSON per file and compare each local digest with the corresponding pinned upstream Git-LFS object ID or another trusted checksum source. No model artifact was downloaded or hashed. S5 remains partial until the exact revision, every artifact digest, and the actual shipped notice payload are verified.

## 2026-11-08 S3 manual procedure source verification

The proposed manual CLI test is consistent with the current implementation: `harness code --provider ollama --model <tag> --sandbox none` withholds command execution while leaving gated file tools available. The `package.json` path-criticality signal is 0.5 (below the default 0.8 threshold), so its edit should be held. The built-in credential-path rule matches `.env.production` and hard-denies the read without an approval override. This confirms the test setup from source; S3 remains partial until the owner runs a live Ollama session and retains the terminal/session-log evidence.
