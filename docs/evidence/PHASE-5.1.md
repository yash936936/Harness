# Phase 5.1 real Crabbox evidence

**Status: BLOCKED-HARDWARE.** PR #12 merged a fake-CLI-tested fix forwarding APPDATA/LOCALAPPDATA and XDG state/cache roots. The actual Harness-to-Crabbox lease/run/release has not been run after that fix. Unit tests use fake providers and do not prove a container ran.

Run from repository root on the target Windows machine with Docker Desktop running and `crabbox` on PATH:

```powershell
npm ci
crabbox --version
crabbox doctor --provider local-container --local-container-runtime docker
$env:HARNESS_REAL_CRABBOX="1"
npm run test:real-sandbox 2>&1 | Tee-Object docs/evidence/PHASE-5.1.raw.txt
```

Before the real test, reproduce the owner's stripped-environment ssh-keygen check from section 3 of docs/BUILD-PLAN.md. Record both full-environment and stripped-environment results. Then paste the full unedited output below. Record date/time, Windows build, Docker version, Crabbox version and exit code. Do not close until Harness creates the lease, commands exit 0 and 7 are reported correctly, the lease is released, docker ps -a is clean, . Host-sentinel absence and orphan recovery are recorded separately under S1 in the audit closeout.

## Raw output

`[OWNER: paste exact output here]`

## Environment
- Date/time:
- Windows build:
- Docker version:
- Crabbox version:
- Exit code:
