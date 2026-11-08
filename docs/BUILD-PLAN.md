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

A green `npm test` does not mean Docker ran. The regular sandbox unit tests use a fake Crabbox CLI or fake E2B client. Two opt-in checks exercise the real Crabbox executable: `npm run test:real-sandbox` (the fuller acceptance test, including exit codes 0 and 7) and `npx tsx scripts/smoke-crabbox.ts` (doctor, lease/run/release, successful output, and a failing command returning exit code 3). Neither is run by ordinary CI. The smoke script does not replace the host-sentinel or orphan-reaper acceptance in S1.

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

Record the full raw output, date/time, Windows build, Docker version, Crabbox version and exit codes in docs/evidence/PHASE-5.1.md. The S0 acceptance gate requires a real Harness-created lease, a command executed inside the container, correct exit codes 0 and 7, confirmed release, and no leftover container. Host-only sentinel absence and orphan recovery are separate S1 gates.

## 4. Locked decisions

- Evaluation (D-109): at least 10 real model-driven sessions; use 20+ if already collected. The owner is the single labeler. The generating model may not label its session. Run `powershell -ExecutionPolicy Bypass -File scripts/commit-eval-labels.ps1 -LabelsPath <path-to-labels.json>` to hash and commit the exact labels file before scorer output is generated or viewed. `scripts/eval-calibrate.ts` also verifies the committed labels, clean working copy, and SHA-256 sidecar before it emits any scorer output. Require both good and bad labels. Do not require 90% agreement. Report raw agreement, counts and confusion table as prototype-grade, not calibrated.
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


## 2026-11-08 verification update

The owner reported a full local `npm test` run with **56 test files passed, 1 skipped; 1,182 tests passed, 22 skipped; 0 failures; 64.00 seconds**. The result is recorded in [docs/evidence/TEST-SUITE-2026-11-08.md](evidence/TEST-SUITE-2026-11-08.md). The earlier concurrent-writers test also passed three consecutive isolated runs (about 1.55-1.62 seconds each) and did not time out in the reported full-suite run.

This is local owner-reported evidence, not a new GitHub Actions result. `test/sandbox-real.test.ts` was skipped (2 tests), so this does not close S0.

Current gates:
- **Automated test suite:** PASS for the reported local run.
- **S0 / ARCH-01:** BLOCKED-HARDWARE. Still requires the stripped/full environment diagnosis and real Windows + Docker + Crabbox doctor, lease, command exit codes 0 and 7, release confirmation, and clean `docker ps -a` evidence.
- **S1:** OPEN. The current Crabbox provider's `finally` cleanup cannot run after process termination. The host-sentinel assertion exists in the opt-in real-sandbox test, but no process-death/orphan-reaper acceptance has been demonstrated. Do not treat ordinary unit tests as S1 evidence.
- **Local Git working tree:** not inspected by this remote documentation update. Before pulling or committing, preserve the local worktree and inspect `git status --short`, `git diff --stat`, and `git diff --cached --stat`.

The Windows owner must run S0 on the target machine. S1 implementation must be based on observed Crabbox lease-list output and a deterministic ownership marker; do not stop arbitrary leases or infer ownership from an unverified output format.


## 2026-11-08 recurring-failure prevention

The cross-chat and repository failure audit is maintained in [docs/RECURRING-FAILURE-AUDIT.md](RECURRING-FAILURE-AUDIT.md). It records confirmed causes, fixes already merged, unresolved evidence, and the rule for future runs.

For Crabbox, run doctor first and do not attempt warmup when it fails. The provider now has separate doctor, lease-control, and total cleanup budgets. The real acceptance test and standalone smoke use the same bounded budgets. This is a responsiveness fix, not S0 evidence.

Current blockers remain: host-side rsync is missing in the recorded Windows doctor output; the captured container's exit 255 is unexplained; S1 orphan recovery has not been implemented or accepted. Do not modify SSH environment forwarding, bootstrap, or port mapping without new evidence. See the recurring-failure audit for the exact evidence boundary and next diagnostic.


For a short, read-only Windows prerequisite and stale-container capture, use:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/diagnose-crabbox.ps1 -ContainerId <container-id>
```

The script checks the supported WSL transfer tools, Windows tool paths, Docker context/engine, Crabbox doctor, and (when an ID is supplied) a bounded container log/event tail. It does not create, stop, or remove containers. Use the upstream Windows installation guide linked from the recurring-failure audit to select the correct rsync/SSH pairing.
