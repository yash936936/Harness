# S0 / ARCH-01 transport incident report

Date prepared: 2026-11-08  
Repository: yash936936/Harness  
GitHub baseline used for this report: fb4f2fa27570254c62a5cdfc16e392a77ff7c875 (main, PR #20 merged)  
Current documentation branch: work/continue-independent-closeout-2026-11-08

## Executive finding

S0 is **PENDING-ENVIRONMENT**. The latest reproducible state in the conversation is: a pinned local-container image completes Crabbox warmup, the lease is reported ready, inspect works, and the Docker container is running. The subsequent crabbox run fails before the requested in-container command executes, while Crabbox attempts to create its private WSL SSH transport file:

~~~text
rsync failed: write private WSL SSH transport file:
exit status 1: crabbox: 1: cannot create : Directory nonexistent
chmod: cannot access '': No such file or directory
~~~

Stopping the lease succeeded. No successful in-box command, exit-code 0/7 verification, host-file isolation result, or full Harness real-sandbox acceptance is established.

This report records the sequence and evidence discussed in this project's conversation. It does not claim to be a complete export of every historical chat or raw machine log. Where the exact raw output was not supplied in the conversation, it is described as owner-reported rather than reproduced as a transcript.

## Incident timeline from the conversation

### 1. Initial Windows/Crabbox prerequisite failures

Earlier S0 attempts on the Windows machine showed Crabbox doctor reporting a missing host-side rsync prerequisite. The discussion distinguished host-side transfer tools from packages installed inside the Linux container: installing rsync in the container does not satisfy Crabbox's Windows host/WSL transfer requirement.

The upstream Crabbox Windows installation guidance was checked during the investigation. The supported Windows routes discussed were:
- WSL2 default distribution with native Linux rsync and OpenSSH; or
- on supported x64 setups without WSL, an MSYS2 rsync.exe and its sibling MSYS2 ssh.exe from the same installation.

Mixing MSYS2 rsync with System32 OpenSSH was identified as an unsupported pairing. This prerequisite finding is historical context; it is not proven to be the cause of the latest empty-path error.

### 2. SSH-key environment hypothesis tested

The earlier investigation considered whether the child process environment omitted Windows profile/cache variables needed by ssh-keygen. PR #12 added forwarding for APPDATA, LOCALAPPDATA, XDG_STATE_HOME, and XDG_CACHE_HOME.

Later Windows ProcessStartInfo probes were reported to show that ssh-keygen succeeded with both full and stripped environments. The investigation therefore did not support adding more environment variables or changing the allowlist without a new failing reproduction.

### 3. Container bootstrap interruption and exit 255

A subsequent real attempt was reported in which Crabbox doctor passed after a session-only MSYS2 PATH adjustment. During container provisioning, the Ubuntu container exited with status 255 while APT was unpacking python3-minimal.

In the same incident window, Windows Docker Desktop logs showed a new com.docker.backend.exe process, API proxy resets, and WSL engine initialization. The conversation did not establish why Docker Desktop restarted or prove that a nearby Codex sandbox-service crash caused it. The trigger remained unknown.

The response was to add a pinned prebuilt image path:
- Dockerfile.crabbox-s0 preinstalls the required Linux tools.
- HARNESS_CRABBOX_IMAGE allows the real test to select that image.
- PR #19 merged and CI passed (run #286).

This change avoids repeating APT installation during lease bootstrap. It does not establish that the later WSL transport problem is fixed.

### 4. Warmup diagnostics improved

PR #20 preserved both stdout and stderr from Crabbox warmup failures, plus spawn error, timeout state and exit code, with bounded diagnostic output. It merged to main and GitHub Actions run #289 passed.

This was a diagnostics improvement. It did not change the WSL workspace transport path.

### 5. Pinned image warmup and inspect succeeded

The owner later reported a successful pinned-image warmup using:
- provider: local-container
- runtime: Docker
- image: harness-crabbox-s0:ubuntu-pinned

Crabbox reported a ready lease, SSH endpoint, work root /work/crabbox, and warmup completion in approximately 16 seconds. The PowerShell process returned exit code 0. crabbox list showed the container running with its SSH port published on loopback. crabbox inspect also worked.

These results establish provisioning/readiness for that attempt, not workload execution.

### 6. Run failed before workload execution

Both the synced run and the attempted execution path failed in the Windows/WSL SSH transport setup with the empty-path diagnostic quoted in the executive finding. The requested shell command did not execute, so the intended echo, id -u, and workload exit-code assertions were not reached.

The observed empty path is consistent with a missing or incorrectly forwarded path argument in the private-file creation step. That is a diagnostic clue, not a confirmed root cause. The conversation has not isolated whether the fault is in WSL argument forwarding, Crabbox's transport helper, or the selected WSL distribution/tool configuration.

### 7. Lease stop succeeded

The owner reported that crabbox stop succeeded and the lease disappeared from the provider list. This is useful lifecycle evidence, but it does not close S0 because run acceptance failed before the workload started.

## Evidence matrix

| Requirement | Current evidence | Disposition |
|---|---|---|
| Pinned local-container image builds | Dockerfile and image were used in the reported warmup | Provisioning path exercised |
| Crabbox warmup | Ready lease; exit code 0; about 16 seconds | PASS for warmup only |
| Crabbox inspect | Succeeded for the lease | PASS for inspect only |
| Docker container readiness | Container reported running; loopback SSH port published | PASS for readiness only |
| crabbox run executes workload | Failed before in-box command | NOT PASSED |
| Exit code 0 workload | Command not reached | PENDING |
| Exit code 7 propagation | Command not reached | PENDING |
| Harness real-sandbox test | Not completed against real provider | PENDING |
| Host-file isolation | No accepted result from this attempt | PENDING |
| Lease stop/release | Stop succeeded; lease disappeared from list | PASS for observed stop/list lifecycle |
| S1 orphan recovery | No process-kill/restart ownership test | OPEN, dependent on S0 |

## Changes already made and their limits

| Change | What it addresses | What it does not prove |
|---|---|---|
| PR #12 environment forwarding | Windows child-process environment compatibility | Does not prove current transport helper is fixed |
| PR #17 bounded doctor and cleanup | Prevents warmup after failed doctor and bounds cleanup waits | Does not solve WSL file creation |
| PR #19 pinned Crabbox image | Avoids package installation during lease bootstrap | Does not fix host/WSL sync |
| PR #20 warmup diagnostics | Preserves stdout and stderr on warmup failure | Does not change run/sync behavior |

## Current disposition and pause boundary

**S0 / ARCH-01: PENDING-ENVIRONMENT.** The owner asked to defer the current transport issue and continue independent planned work. Do not rerun the same transport diagnostic or modify SSH environment forwarding, image bootstrap, Docker port mapping, or provider code until the owner resumes S0 or new evidence identifies a failing layer.

S1's real orphan-recovery acceptance remains dependent on a working S0 lease/run path. Do not implement a reaper using guessed Crabbox list output, and do not stop leases that cannot be proven Harness-owned.

## Resume checklist

When the owner chooses to resume S0, collect one complete evidence bundle in this order:

1. Crabbox version and WSL distribution list.
2. Confirm the default WSL distribution has native Linux rsync, ssh, and mktemp.
3. Create a private temporary WSL directory and test shell positional-argument handoff to a file path; verify mode and contents.
4. Run crabbox run --no-sync with a trivial in-box command.
5. Run the synced crabbox run with a trivial in-box command.
6. Run npm run test:real-sandbox with HARNESS_REAL_CRABOX=1 and HARNESS_CRABBOX_IMAGE=harness-crabbox-s0:ubuntu-pinned.
7. Preserve raw output, exit codes, lease identifiers, Docker inventory before/after, and stop/list result.

Only after the isolated probe identifies the failing layer should code or environment changes be selected. A passing S0 run must demonstrate actual in-box execution, exit codes 0 and 7, confirmed release, and no leftover test container. S1 host sentinel and orphan recovery remain separate acceptance items.

## Work to continue while S0 is paused

Independent work can proceed without claiming S0:
- S3: code review and manual governed CLI acceptance preparation; manual terminal approval/denial still needs an owner-run session.
- S5: exact production dependency notice inventory and immutable Qwen artifact provenance preparation.
- S6: evaluation data collection/label-provenance preparation; no synthetic sessions or labels.
- S7: inspect and prepare real embedding/poisoning acceptance, clearly separating scripted tests from live-provider evidence.
- S8: reconcile the audit table against committed evidence after each independent gate.

S4 full coding acceptance may require a working sandbox for the requested end-to-end path; do not mark it complete from isolated provider smoke tests. S1 remains dependency-blocked. This is a work-order change only, not a change to acceptance criteria.
