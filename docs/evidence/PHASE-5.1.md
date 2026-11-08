# Phase 5.1 real Crabbox evidence

**Status: BLOCKED-HARDWARE.** PR #12 merged a fake-CLI-tested fix forwarding APPDATA/LOCALAPPDATA and XDG state/cache roots. The actual Harness-to-Crabbox lease/run/release has not been run after that fix. Unit tests use fake providers and do not prove a container ran.

Run from repository root on the target Windows machine with Docker Desktop running and `crabbox` on PATH:

```powershell
npm ci
crabbox --version
crabbox doctor --provider local-container --local-container-runtime docker
$env:HARNESS_REAL_CRABBOX="1"
npm run test:real-sandbox 2>&1 | Tee-Object docs/evidence/PHASE-5.1.raw.txt
docker ps -a
```

Before the real test, reproduce the owner's stripped-environment ssh-keygen check from section 3 of docs/BUILD-PLAN.md. Record both full-environment and stripped-environment results. Then paste the full unedited output below. Record date/time, Windows build, Docker version, Crabbox version and exit code. Do not close until Harness creates the lease, commands exit 0 and 7 are reported correctly, the lease is released, docker ps -a shows no leftover container. Host-sentinel absence and orphan recovery are separate S1 gates and are not part of S0 closeout.

## Raw output

`[OWNER: paste exact output here]`

## Environment
- Date/time:
- Windows build:
- Docker version:
- Crabbox version:
- Exit code:


## 2026-11-08 real-run attempt (owner-reported Windows output)

Environment observed:
- Crabbox CLI: 0.73.0.
- Docker Desktop: 4.65.0; Engine: 29.2.1; context: `desktop-linux`.
- The first Docker check could not connect because the Docker Desktop Linux engine pipe was unavailable. A later `docker version` showed the server running.
- `npm ci` completed; npm reported 0 vulnerabilities. npm also warned that the esbuild install script was not approved by the install-scripts policy.

Crabbox doctor, after Docker became reachable:
- Git, Windows OpenSSH `ssh`, and `ssh-keygen` were found.
- Per-lease SSH key support was reported OK.
- `rsync` was missing.
- The provider inventory/list probe returned one lease and runtime 29.2.1, but doctor still exited as failed; it reported `ssh_probe=unchecked` and `docker_socket=false`.

Real test result:
- `doctor passes`: FAIL because `d.ok` was false; the displayed doctor output includes the missing `rsync` check.
- `runs inside the box...`: FAIL during warmup/lease creation: key generation for `cbx_d25e59d79acb` exited 255 with empty output. The test did not reach in-box command execution or exit-code assertions.
- The subsequent `docker ps -a` showed a Crabbox-named container `crabbox-harness-ssh-capture-65a66291` in `Exited (255)` state. Other stopped containers were present from unrelated projects. This output is not evidence of successful Harness lease release.

Acceptance: **S0 remains BLOCKED**. Do not claim a successful lease, command execution, exit codes 0/7, release, or clean Docker state. The exact terminal transcript was captured by the owner in the local untracked `docs/evidence/PHASE-5.1.raw.txt`; it has not been committed by this documentation update.

Next diagnostics required before changing code:
1. Run the documented full-environment and stripped-environment `ssh-keygen` checks from section 3 of `docs/BUILD-PLAN.md`, and record each exit code.
2. Run `where.exe ssh-keygen`, `where.exe rsync`, and `Get-Command ssh-keygen,rsync -ErrorAction SilentlyContinue | Format-List Name,Source`.
3. Inspect the failed capture container with `docker logs crabbox-harness-ssh-capture-65a66291` and `docker inspect --format '{{.State.Status}} {{.State.ExitCode}} {{.State.Error}}' crabbox-harness-ssh-capture-65a66291`. Do not remove it before preserving the evidence.
4. Re-run `crabbox doctor --provider local-container --local-container-runtime docker` after addressing the missing `rsync` dependency and capture its complete output.
