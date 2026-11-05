# Phase 5.1 real Crabbox evidence

**Status: BLOCKED-HARDWARE.** No real Docker/Crabbox run was available while preparing this change. Unit tests use fake providers and do not prove a container ran.

Run from repository root on the target Windows machine with Docker Desktop running and `crabbox` on PATH:

```powershell
npm ci
crabbox --version
crabbox doctor --provider local-container --local-container-runtime docker
$env:HARNESS_REAL_CRABBOX="1"
npm run test:real-sandbox 2>&1 | Tee-Object docs/evidence/PHASE-5.1.raw.txt
```

Paste the full unedited output below. Record date/time, Windows build, Docker version, Crabbox version and exit code. Do not close until doctor and both real tests pass and the host-only sentinel is absent inside the container.

## Raw output

`[OWNER: paste exact output here]`

## Environment
- Date/time:
- Windows build:
- Docker version:
- Crabbox version:
- Exit code:
