# Harness build plan and testing guide

Last updated: 2026-11-07. Scope: a working prototype, not the full product. This plan supplements the historical phase documents.

## 1. Where things stand

Done, with evidence in the repo or CI:

- Core TypeScript prototype on Cordis; Apache-2.0 license for original project code.
- Scope reset documented.
- Windows file-lock paused-holder acceptance passed with Sysinternals PsSuspend 1.09 (15 tests passed).
- Governed harness code command exists with terminal approvals, session logging, and fail-closed command-tool availability.
- PR #11 (Ollama timeout) and PR #12 (Crabbox Windows user-state environment) merged.
- GitHub Actions run #63 passed on Ubuntu and Windows on commit e93ff1edff16b9c643eecf54ec2b3985e5829369.

Not done:

- Harness itself has not yet completed a verified real sandbox lease/run/release. The reported failure was SandboxError: crabbox could not lease a box (generate ssh key for cbx_...: exit status 255:). PR #12 fixes a related missing Windows user-state environment variable, but a real rerun is still required.
- Host-sentinel and orphan-reaper acceptance has not been demonstrated.
- Live full coding acceptance through both OpenRouter and Ollama is not complete.
- Production dependency notices, Qwen immutable provenance, real-data evaluation, real retrieval/poisoning tests, and the desktop product remain open or partial.
- harness run is one bare model call; the governed path is harness code.

A green npm test does not mean Docker ran. Sandbox unit tests use a fake Crabbox CLI or fake E2B client. Only npm run test:real-sandbox touches Docker and the real Crabbox executable.

## 2. Stages

| Stage | Work | Gate (evidence required) |
|---|---|---|
| S0 | Fix ARCH-01: diagnose the ssh-keygen failure, patch, rerun the real sandbox test | Raw output in docs/evidence/PHASE-5.1.md: lease created by Harness, command ran inside the container, exit codes 0 and 7 reported, lease released, docker ps -a clean |
| S1 | Prove it is the container and not the host. Kill Harness mid-lease and confirm the orphan is reaped on restart | Host-sentinel file absent inside the box. Orphan case logged. Reaper added with a test if missing |
| S2 | Land PRs #11 and #12 | CI green on Ubuntu and Windows on the latest commit before merging |
| S3 | Make the governed path reachable with harness code | Scripted-model test plus one manual run showing a gated write, a hard-blocked action and an approval, all in the session log |
| S4 | Live acceptance: one real coding task on OpenRouter, one on Ollama, through harness code | Session logs saved, key absent from logs and stdout, result checked by running the target project's tests |
| S5 | Licensing and provenance | THIRD_PARTY_NOTICES from the production lockfile, json-bignum text kept, models.lock.json with Qwen 7B revision and SHA-256s, tampered-file test |
| S6 | Evaluation | Labels hashed and committed before scorer output is viewed; at least 10 real sessions (20+ if already collected), both classes, no agreement cutoff, prototype-grade confusion report (D-109) |
| S7 | Retrieval and poisoning | Real embedding provider run, injected instructions wrapped in boundary markers and not obeyed |
| S8 | Final audit | docs/AUDIT-CLOSEOUT.md with one evidenced row per item, README split into implemented and experimental |

S0 blocks S1. S2 can run alongside S0. S5 and S6 do not need the sandbox, so labeling can happen while Docker problems are being worked.

Deferred, to be labelled experimental in the README: CubeSandbox, Needle router evaluation/ownership, a full desktop client beyond benchmarks, Qdrant, Langfuse, the browser tool, multi-user support.

## 3. ARCH-01 diagnosis

Upstream Crabbox generates the lease key by running:

~~~text
ssh-keygen -q -t <type> -N "" -C "crabbox <lease>" -f <key path>
~~~

Exit status 255 with empty output means ssh-keygen died before printing anything. Direct Crabbox runs reportedly work while Harness-launched runs fail. The environment difference is a hypothesis, not a confirmed cause.

PR #12 merged a related fix: the subprocess allowlist now forwards APPDATA, LOCALAPPDATA, XDG_STATE_HOME and XDG_CACHE_HOME. Its fake-CLI regression test verifies these variables reach Crabbox. The PR body identifies Go os.UserConfigDir() failing when Windows APPDATA is absent. This does not prove that the original ssh-keygen exit-255 symptom is fixed.

On the target Windows machine, run the following one at a time in PowerShell:

~~~powershell
# Full environment
$k1 = Join-Path $env:TEMP "harness-key-full"
ssh-keygen -q -t ed25519 -N "" -C "harness full env" -f $k1
$LASTEXITCODE

# Stripped environment in a child cmd process
cmd /c "set USERPROFILE=&& set HOME=&& set APPDATA=&& ssh-keygen -q -t ed25519 -N """" -f %TEMP%\harness-key-stripped"
$LASTEXITCODE

# Identify the executable selected on PATH
where.exe ssh-keygen

# Check Crabbox and Docker versions/doctor
crabbox --version
docker version
crabbox doctor --provider local-container --local-container-runtime docker
~~~

If the stripped run fails, compare the actual child environment and add only required non-secret OS/user directory variables to BASE_ENV in src/bundles/sandbox-crabbox/index.ts, with a regression test that fails on old code. If both runs succeed, inspect which ssh-keygen comes first (Git for Windows vs Windows OpenSSH), key-directory permissions/antivirus, and long or spaced paths. Do not assume the environment hypothesis.

After a confirmed fix, run from repository root:

~~~powershell
$env:HARNESS_REAL_CRABBOX = "1"
npm run test:real-sandbox 2>&1 | Tee-Object docs/evidence/PHASE-5.1.raw.txt
docker ps -a
~~~

Record the full raw output, date/time, Windows build, Docker version, Crabbox version and exit codes in docs/evidence/PHASE-5.1.md. The acceptance gate requires a real Harness-created lease, a command executed inside the container, correct exit codes 0 and 7, confirmed release, no leftover container, and a host-only sentinel absent inside the sandbox.

## 4. Locked decisions

- Evaluation (D-109): at least 10 real model-driven sessions; use 20+ if already collected. The owner is the single labeler. The generating model may not label its session. Hash and commit the exact labels file before scorer output is generated or viewed. Require both good and bad labels. Do not require 90% agreement. Report raw agreement, counts and confusion table as prototype-grade, not calibrated.
- No host fallback: run_command fails closed when no sandbox is available. If Docker is missing, harness code says commands are disabled and file tools remain gated.
- Qwen: no weights are bundled. The 7B model must be downloaded from upstream at a pinned revision and every artifact file checked against SHA-256. The 3B model stays excluded.
- Policy gates: never disable policy gates in profile-coding or higher profiles.
- Tauri: remains provisional under D-048 until target-machine benchmark evidence exists.
- Architecture: TypeScript/Cordis remains fixed for this prototype.

## 5. Common testing problems

| Symptom | Likely cause | What to do |
|---|---|---|
| Everything passes but Docker was never started | Sandbox tests use fakes | Run npm run test:real-sandbox with Docker running and Crabbox on PATH |
| could not lease a box (generate ssh key ... 255) | Possible missing environment variables | Run the full/stripped environment checks in section 3; do not assume |
| ssh readiness timeout | Container is up but SSH is not accepting yet, or the key was not installed | Run docker ps -a and docker logs <container>, then retry once Docker is idle |
| Leftover containers after a failed run | Lease not released | Run docker ps -a, then docker rm -f <id>; record it and inspect orphan cleanup |
| npm test shows about 100 skipped | Missing ripgrep, no live Ollama, opt-in real sandbox test | Record counts and skip reasons |
| && fails in PowerShell 5.1 | Windows PowerShell 5.1 has no && operator | Put each command on its own line |
| Lock tests hang or fail on Windows | PsSuspend missing | Install Sysinternals PsSuspend 1.09 and put it on PATH |
| git apply --check fails | Branch moved | Pull latest main, then reapply or regenerate the patch |

## 6. Definition of done

- Harness creates a real lease, runs a command inside the container, reports exit code and releases the lease.
- Ubuntu and Windows CI are green on the latest commit.
- A user can run harness code and see policy gates, approvals and sandbox behavior.
- Licensing and model provenance are documented with verifiable evidence.
- Evaluation results are recorded and labelled prototype-grade.
- Everything unfinished is listed as experimental or blocked in the README and audit.
