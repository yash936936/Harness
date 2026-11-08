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

## 2026-11-08 follow-up: prevent repeated long waits

A review of the provider and opt-in test found a test-flow problem: doctor and lease startup were separate Vitest cases, so a failed doctor did not stop the lease test. The real test also used a 600-second timeout for warmup, stop, and list. Because failed warmup still enters cleanup, the two-attempt stop/list loop could wait through multiple long timeouts.

The follow-up patch adds a 45-second doctor timeout and a 10-second total cleanup budget in the real acceptance configuration (15 seconds by default in the provider) and moves doctor + lease acceptance into one test. The standalone smoke script uses the same bounded timeouts. Warmup is attempted only after doctor passes. A fake-CLI regression checks that stop/list receive the cleanup budget rather than the startup timeout.

This is a test/runtime responsiveness fix, not a diagnosis of the container's exit code 255. The host-side missing rsync and unexplained container exit remain open. S0 remains blocked until a real lease, command exit codes 0 and 7, release, and clean container inventory are demonstrated.


## Windows rsync prerequisite clarification

The host-side rsync failure is a Windows transport prerequisite, not a missing package inside the Linux image. Upstream Crabbox's supported Windows paths are:

- Preferred: WSL2 with a default WSL distribution containing native Linux rsync and OpenSSH. Crabbox invokes the default distribution without a distro name.
- x64 without WSL: MSYS2 rsync.exe and the sibling MSYS2 ssh.exe from the exact same directory. Do not pair MSYS2/Cygwin rsync with the native System32 OpenSSH client.

Upstream guide: https://github.com/openclaw/crabbox/blob/main/docs/windows-install.md

For the preferred WSL2 path, verify the default distro with:

```powershell
wsl.exe sh -c 'command -v rsync || exit 1; command -v ssh || exit 1'
```

After the supported transfer toolchain is available, rerun:

```powershell
crabbox doctor --provider local-container --local-container-runtime docker
```

Do not rerun the real Harness acceptance while doctor fails. This prerequisite does not explain the captured container's later exit 255 by itself; keep that cause open until Docker events and a successful doctor are correlated.

## 2026-11-08 follow-up: prebuilt image for the S0 retry

The later Windows attempt passed Crabbox doctor after the host rsync/SSH tools were made available through the session PATH, but the container exited 255 while Ubuntu was unpacking `python3-minimal`. Docker Desktop launched a new backend and restarted its WSL engine/API proxies during the same window. The logs establish an infrastructure interruption during bootstrap; they do not prove why Docker Desktop launched or that Harness caused it.

To avoid repeating package installation inside every S0 lease, the repository now includes `Dockerfile.crabbox-s0`. It pins the same Ubuntu base digest observed in the failed container and preinstalls the exact bootstrap prerequisites (`openssh-server`, `ca-certificates`, `git`, `rsync`, `curl`, `sudo`, and `python3`). The real test accepts an optional `HARNESS_CRABBOX_IMAGE` and passes it to Crabbox's `--local-container-image` option. When unset, the existing default image behavior is unchanged.

On the target Windows machine, from the repository root, with Docker Desktop fully running:

```powershell
docker info
crabbox doctor --provider local-container --local-container-runtime docker
docker build -f Dockerfile.crabbox-s0 -t harness-crabbox-s0:ubuntu-pinned .
$env:HARNESS_CRABBOX_RUNTIME = "docker"
$env:HARNESS_CRABBOX_IMAGE = "harness-crabbox-s0:ubuntu-pinned"
$env:HARNESS_REAL_CRABBOX = "1"
npm run test:real-sandbox 2>&1 | Tee-Object docs/evidence/PHASE-5.1.raw.txt
docker ps -a
```

If `docker info` or Crabbox doctor fails, stop before building or running S0. Do not restart Docker Desktop during the run. The prebuilt image removes the repeated in-lease APT install, but it does not repair a Docker Desktop/WSL restart and is not itself S0 evidence.

S0 remains **BLOCKED** until the real test proves: successful command exit 0, host sentinel absent inside the box, failing command exit 7, both leases confirmed released, and no Harness-owned container left behind. Record the exact output, environment versions, and final `docker ps -a` state below. Do not copy a green unit-test or CI result into this section as real-sandbox evidence.
