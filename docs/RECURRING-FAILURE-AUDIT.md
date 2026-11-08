# Recurring failure audit: Crabbox, Docker, CI, and test workflow

Date: 2026-11-08  
Repository: `yash936936/Harness`  
Scope: evidence available in this Harness project context, the current repository, `docs/debug.md`, `docs/decisions.md`, `docs/BUILD-PLAN.md`, `docs/AUDIT-CLOSEOUT.md`, and Phase 5.1 evidence. This is not a claim that every historical chat was independently retrievable in full.

## Findings and disposition

| Area | Repeated symptom / root cause | Status | Prevention or next action |
|---|---|---|---|
| Real sandbox test flow | Doctor and lease startup were separate Vitest tests. A failed doctor did not stop the second test from attempting a real warmup. | Fixed in PR #17; CI passed run #278 on Ubuntu and Windows | Doctor and lease acceptance now run in one test. No warmup is attempted unless doctor passes. |
| Crabbox wait time | The real test set a 600-second timeout for control operations. Failed warmup still entered cleanup, and cleanup could retry stop/list twice using the same long timeout. | Fixed in PR #17, pending CI | Separate 45-second doctor timeout, 180-second control timeout, and 10-second total cleanup budget in the real test. Provider defaults are 45 seconds for doctor and 15 seconds total for cleanup. |
| Smoke command timeout | The standalone Crabbox smoke script omitted timeoutMs on its two run requests. CrabboxProvider passed 0 to Subprocess, which disables the timeout. | Fixed in PR #17, pending CI | Both smoke commands now have a five-minute timeout; doctor, control, and cleanup also use bounded stage budgets. |
| Host rsync / Windows transport | Crabbox doctor on Windows reports host-side `rsync` missing. Installing rsync inside the Linux container does not satisfy the host prerequisite. Upstream supports a default WSL2 distribution with native Linux rsync + OpenSSH (preferred), or on x64 without WSL, the matched MSYS2 `rsync.exe` + sibling MSYS2 `ssh.exe` from the same directory. Random rsync builds or mixing MSYS2 rsync with System32 OpenSSH are unsupported. | Open | Follow the upstream [Windows install guide](https://github.com/openclaw/crabbox/blob/main/docs/windows-install.md). Verify WSL2 with `wsl.exe sh -c 'command -v rsync || exit 1; command -v ssh || exit 1'`, or verify the exact MSYS2 sibling pair on x64. Then rerun provider doctor. Do not start real acceptance while doctor fails. |
| Windows SSH-key environment hypothesis | PR #12 forwarded APPDATA, LOCALAPPDATA, XDG_STATE_HOME, and XDG_CACHE_HOME. Later ProcessStartInfo probes showed ssh-keygen exits 0 with both full and stripped environments. | Environment hypothesis not reproduced | Keep the allowlist fix. Do not add more environment variables or change BASE_ENV without a failing reproduction. |
| Container exit 255 | Captured container logs show sshd listening on port 2222 and accepting a public-key login. The SSH client then disconnected normally. Docker later reported the container exited 255, without OOM or Docker Error. | Root cause unknown | Preserve the container/log evidence. Inspect Docker events for kill/stop/die before changing bootstrap or port mapping. No successful in-box command is established by SSH authentication alone. |
| Docker engine availability | The first Docker check could not reach the Docker Desktop Linux engine pipe; a later check succeeded. | Environmental prerequisite observed | Before a real run, verify `docker info` and Crabbox doctor. Do not rerun a long acceptance test while the engine is unavailable. |
| Orphan leases | Provider cleanup is in `finally`; it cannot run if the Harness process is killed. No verified orphan reaper exists. | Open, S1 | First capture exact Crabbox list output and a deterministic Harness ownership marker. Then implement and test reaping only Harness-owned leases. Never stop arbitrary or unclaimed leases. |
| Release correctness | Earlier code could report release from list output alone and could miss normalized Crabbox identifiers. | Fixed in commit `e138e4b` with fake-CLI regressions | Preserve the rule: stop must exit successfully and list must confirm the lease is absent under all observed identifiers. |
| Sandbox working directory | Earlier provider did not set Crabbox's working directory, so the synced checkout could be wrong. | Fixed in commit `e138e4b` | Keep profile-coding's project root as Crabbox cwd; retain the regression. |
| Crabbox doctor diagnostics | Earlier doctor reporting discarded useful stdout and showed only a generic stderr summary. | Fixed; current doctor combines stdout and stderr | Keep both streams in diagnostics and cap output. |
| Fake versus real tests | Ordinary sandbox tests use a fake Crabbox CLI. A green `npm test` does not prove Docker or a real lease ran. | Documented; real gate still open | Keep real acceptance opt-in and separate. Do not label S0 complete from unit tests or CI. |
| Retrieval-grep regressions | Nested `.git` and `node_modules` paths, Windows case-insensitive paths, fixture directory creation, and a false positive on names such as `.git-credentials` caused repeated test churn. | Fixed in commits `7e457c3`, `9d96aea`, `65f161c`, `5b8cf42`, `7acaf09`, `a164318` | Retain source-level exact path-component filtering and platform-aware fixtures. |
| Empty file-lock wedge | A crash between creating a lock and writing its JSON left an empty lock that callers could not age out. | Fixed in commit `e138e4b` | Retain the old-empty and young-empty regression tests. |
| PowerShell command failures | PowerShell 5.1 does not support `&&`; direct ssh-keygen tests were initially affected by shell quoting rather than ssh-keygen itself. | Diagnosed | Run commands on separate lines. Use ProcessStartInfo for arguments that PowerShell quotes ambiguously. |
| Large terminal output | Long logs cannot reliably fit in one terminal paste and cause repeated diagnostic cycles. | Workflow rule | Run `powershell -ExecutionPolicy Bypass -File scripts/diagnose-crabbox.ps1 -ContainerId <id>` for a short, read-only Windows preflight and event capture. It prints only tool paths, doctor tail, container state, 12 log lines, and 12 event lines. It never starts or removes a lease. |
| Full-suite repetition | Re-running the 60+ second full suite after every small change wastes time and obscures the failing area. | Workflow rule | Run targeted tests and typecheck first. Run full CI after the batch is ready. The reported 2026-11-08 local suite was 1,182 passed, 22 skipped, 64 seconds; real sandbox tests were skipped. |

## S0 evidence boundary

The latest recorded real attempt did **not** pass S0:

- Crabbox 0.73.0 and Docker Desktop 4.65.0 / Engine 29.2.1 were observed.
- Doctor failed, including the missing host rsync check.
- The real test failed before its in-box command assertions.
- A captured container later showed SSH startup and successful public-key authentication, then exited 255.
- No evidence proves a successful Harness command inside the box, exit codes 0 and 7, confirmed release, or a clean Docker inventory.

Do not change SSH environment forwarding, bootstrap, or port publication based only on the exit code. First collect the Docker event sequence for the exact container and correlate it with the container logs and Crabbox lease record.

## S1 evidence boundary

The current `finally` cleanup is not crash recovery. Before implementing a reaper, record the exact output and schema from the installed Crabbox version for lease listing, labels, IDs, and ownership. The reaper must prove ownership and must leave unrelated leases untouched. Required acceptance: kill Harness mid-lease, restart it, reap only its orphan, and prove unrelated leases remain.

## Execution policy for future debugging

1. Check prerequisites once: Node/npm, Crabbox version, Docker engine, host rsync, and Crabbox doctor.
2. If doctor fails, stop. Do not launch warmup or a real acceptance run.
3. For code failures, run the smallest affected Vitest file and typecheck.
4. For a real runtime failure, preserve one bounded diagnostic capture. Do not repeat the same full bootstrap without a new hypothesis.
5. Keep automated tests, real sandbox acceptance, and crash-recovery acceptance as separate evidence gates.
6. Update this audit and Phase 5.1 evidence when a root cause is confirmed. Record unknowns as unknown, not as fixed.

## Current patch

PR #17: https://github.com/yash936936/Harness/pull/17  
GitHub Actions run #278 passed on Ubuntu and Windows (typecheck, lint, tests). The real sandbox test remained skipped, as expected. The patch bounds Crabbox doctor/cleanup waits and prevents warmup after failed doctor. It does not resolve the missing host rsync, explain exit 255, or implement S1 orphan recovery.

## 2026-11-08 additional S0 attempt: Docker Desktop restart during bootstrap

The owner subsequently reported a real S0 attempt in which Crabbox doctor passed after a session-only MSYS2 PATH adjustment. The created Ubuntu container exited 255 while APT was unpacking `python3-minimal`. In the same incident window, Docker Desktop launched a new `com.docker.backend.exe`, reset its API proxies, and initialized the WSL engine. Windows logs did not establish why the backend launched. A Codex sandbox-service crash occurred shortly beforehand, but no causal link was found.

Disposition: confirmed Docker Desktop/WSL runtime interruption during container provisioning; initiating trigger unknown. Do not modify SSH environment forwarding, port mapping, or Crabbox bootstrap based on this evidence.

Prevention added on branch `fix/s0-prebuilt-crabbox-image-2026-11-08`: `Dockerfile.crabbox-s0` preinstalls the exact Linux tools Crabbox bootstrap otherwise installs, and `test/sandbox-real.test.ts` can select it through `HARNESS_CRABBOX_IMAGE`. This removes the in-lease APT installation from the next acceptance attempt. It cannot prevent a Docker Desktop/WSL restart. S0 remains blocked until the target Windows machine completes the full real acceptance and container inventory checks.
