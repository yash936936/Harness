# Prototype audit closeout

Date: 2026-11-07  
Repository: `yash936936/Harness`  
Scope: working prototype only. Statuses below distinguish committed code, CI, and external acceptance evidence. A green test suite never stands in for a real sandbox, provider, desktop runtime, or human-labelled dataset.

| ID | Status | Evidence path | Owner command / remaining action |
|---|---|---|---|
| ARCH-01 | BLOCKED-HARDWARE | `src/bundles/tools-local/index.ts`, `src/profiles/profile-coding.ts`, `src/cli/code.ts`, `docs/evidence/PHASE-5.1.md` | On Windows with Docker Desktop + Crabbox: `crabbox doctor --provider local-container --local-container-runtime docker`; then `$env:HARNESS_REAL_CRABBOX="1"; npm run test:real-sandbox 2>&1 | Tee-Object docs/evidence/PHASE-5.1.raw.txt`. No host fallback exists; command tool is withheld until doctor succeeds. |
| 5.1 | BLOCKED-HARDWARE | `scripts/real-sandbox.mjs`, `test/sandbox-real.test.ts`, `docs/evidence/PHASE-5.1.md` | Same real Docker/Crabbox command above. Fakes and regular Vitest tests do not prove a container ran. |
| 5.2 | DEFERRED | `src/bundles/sandbox-cubesandbox/`, `docs/decisions.md` (D-024) | Deferred by scope reset. Only reopen on x86_64 Linux with KVM: run the CubeSandbox smoke script with credentials and preserve raw output. |
| ENG-04 | Partial | `LICENSE`, `THIRD_PARTY_LICENSES.md`, `package-lock.json`, `docs/decisions.md` (D-105) | Before distribution, rebuild the exact production bundle and verify included notices: `npm ci; npm run license:inventory`; inspect production dependency closure and retain the json-bignum MIT text in shipped notices. Apache-2.0 covers original repo work, not dependencies. |
| ENG-08 | Partial | `docs/decisions.md` (D-104, D-105), `scripts/verify-model-artifact.ts` | Before any model artifact distribution: pin an immutable Qwen2.5-Coder-7B-Instruct revision, download artifact, write provenance JSON with model/revision/source/SHA-256, then `npx tsx scripts/verify-model-artifact.ts <artifact-file> <provenance.json>`. Qwen 3B remains excluded from commercial distribution absent written permission. No weights are in this repository. |
| 6.2 | BLOCKED-HUMAN | `scripts/eval-calibrate.ts`, `scripts/eval-calibrate-validation.ts`, `docs/evidence/EVAL-10.md`, D-109 | Generate at least 10 distinct real model sessions (20+ if already collected); the owner labels them with both classes, hashes and commits labels before scorer output. No minimum agreement percentage. No fabricated sessions or labels. |
| 6.4 | BLOCKED-HUMAN | `scripts/eval-calibrate.ts`, `docs/evidence/EVAL-10.md`, D-109 | After at least 10 matched labels (20+ if already collected) are committed with SHA-256, run `npm run eval -- <session-log-dir> <labels.json>`. Report raw agreement, class counts and confusion table as **prototype-grade, not calibrated**; no agreement cutoff. |
| ARCH-02 | Partial | `src/bundles/router/`, `src/profiles/profile-coding.ts`, `docs/decisions.md` (D-100) | Safe default is retained (`router.owned` empty for unmeasured classes). Need the actual Needle runtime and frozen-suite comparisons before granting ownership: `npx tsx scripts/eval-router.ts` plus real Needle wrapper command documented by the script. |
| Session logs | Closed | `src/bundles/session-log/`, `test/session-log-multiprocess.test.ts`, `test/fixtures/append-worker.ts`, `docs/debug.md` (DBG-064) | Repository implementation and process-interruption regression are committed; CI run #48 passed tests on Ubuntu/Windows. This is not a hardware power-loss durability claim. |
| File locking | PARTIAL (Windows paused-holder verified) | `src/util/filelock.ts`, `test/session-log-multiprocess.test.ts`, `test/fixtures/append-worker.ts`, `scripts/test-windows-paused-lock.ps1`, `docs/evidence/WINDOWS-LOCK-TAURI-1B4.md` | Windows PsSuspend v1.09 acceptance passed: 15/15 tests, including the OS-suspended live-holder regression. Remaining: run stress tests on each supported target filesystem/platform and retain raw evidence; this Windows run is not a power-loss durability claim. |
| BUG-12 | Partial | `src/bundles/memory/`, `src/profiles/profile-coding.ts`, `test/`, `docs/decisions.md` (D-101) | Code is bounded, source-attributed, actor-granted and input-guard fenced; real model retrieval quality/poisoning remains unmeasured. Run on a configured embedding/vector backend with real sessions and preserve results; no fake-provider pass closes this gate. |
| OpenRouter | BLOCKED-KEY | `src/cli/code.ts`, `scripts/smoke-openrouter.ts`, `docs/evidence/OPENROUTER.md` | Set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` only in env; run `HARNESS_LIVE_OPENROUTER=1 npm run smoke:openrouter`, then one full `npm run harness -- code --provider openrouter --model "$OPENROUTER_MODEL" "<task requiring a gated approval>"`. Scan stdout/session logs/committed files for seeded key material without printing it. |
| Tauri | DEFERRED | `app/desktop/bench/hello-tauri/`, `app/desktop/bench/README.md`, `docs/decisions.md` (D-048, D-104) | Provisional only. Reopen after target 8 GB Windows machine is available: `cd app/desktop/bench; npm install; npm run measure:electron; npm run measure:tauri`; capture installer size, five-run cold start and idle working set with Node core. No measurement was taken here, therefore no Electron fallback decision is justified. |
| 1B.4 | Partial | `app/desktop/bench/`, `src/cli/code.ts`, `docs/decisions.md` (D-104) | Desktop shell with real core, authenticated loopback JSON-RPC, three screens and replay is not implemented. Do not claim the benchmark hello-worlds are a desktop product. |

## What is actually closed

- The governed CLI entry point is present: `npm run harness -- code`. It boots the coding profile, absolute current-directory project root, selected provider, orchestrator, approval callback, and session log. The terminal approval request is explicit, and approve/deny is returned by the terminal IO. The ordinary `run` command remains separate.
- Fail-closed command availability is implemented. Without Docker or when Crabbox doctor fails, `run_command` is excluded and the CLI prints the no-sandbox notice; file tools remain behind their policy gates. There is no host-execution fallback.
- D-106 fixes are present in source and covered by regression tests. D-106 reports the tests failed against old code before passing after the fixes.
- Session-log torn-tail recovery is implemented; the child-process interruption fixture is a process-level regression, not hardware durability proof.
- GitHub Actions run #63 for main commit `e93ff1edff16b9c643eecf54ec2b3985e5829369` passed on Ubuntu and Windows. Both jobs completed `npm ci`, `npm run typecheck`, and `npm test`. CI does not run `npm run lint` as a distinct step. The job summary does not expose detailed Vitest pass/skip totals, so this closeout does not invent them.

## Blocked or partial

- **BLOCKED-HARDWARE:** real Crabbox/Docker lease, execution and release; real Needle runtime; Tauri installed-shell and sidecar measurements. Windows OS-suspended live-holder acceptance is now verified; broader target-filesystem/platform stress remains.
- **BLOCKED-KEY:** one live OpenRouter request and one complete governed OpenRouter task because credentials were not available to this run.
- **BLOCKED-HUMAN:** at least 10 genuine model-driven sessions (20+ if already collected) and owner-only labels committed and hashed before scorer output, with both good/bad classes; no agreement percentage is required. Real-data evaluation depends on that dataset.
- **Partial:** third-party distribution notice verification, immutable Qwen artifact pin/hash, router comparison/ownership, real-model semantic-memory quality, and the full desktop product.

## Deferred by prototype scope

CubeSandbox, Qdrant, Langfuse, browser tool, Needle router ownership absent measured evidence, multi-user support, Linux/macOS acceptance, additional desktop screens, CI license gate, and install-size/RSS thresholds. Tauri remains provisional under D-048, not selected by fresh measurements.

## Defects and limitations found

The closeout found a recordkeeping defect: earlier status entries cited superseded CI runs. Current main was independently checked at run #63, which passed on Ubuntu and Windows. PR #11 and PR #12 are both merged. Historical older status entries contain stale phase descriptions; they remain historical and are superseded by the newest dated entries. The Windows owner acceptance subsequently ran successfully: PsSuspend v1.09, 15/15 tests passed in 20.66 seconds, including the OS-suspended live-holder case. This follow-up updates that evidence without claiming other external gates. The local `npm ci` attempt during the earlier docs-only closeout timed out; no local lint or test result is claimed here. PR #12's fake-CLI environment test does not close the real Crabbox acceptance gate.
