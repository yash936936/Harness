# Audit closeout status

Updated 2026-11-14. This file is a concise current closeout summary. Detailed historical evidence remains in `docs/evidence/`, `docs/debug.md`, and the append-only status/decision logs.

## Current baseline

- Main baseline reviewed: `50d0bb139f0103012de6bf36d48a0f1ee67e1126`.
- Current documentation changes are on `docs/consolidate-current-plan`; they are not yet merged.
- Latest observed CI run #613 is red at `npm audit --omit=dev --audit-level=high` because of nested `zod@4.1.11` in the selected Vercel Sandbox dependency tree.
- GitHub reports `main.protected=false`; branch protection remains an owner action.

## Scope

- D-110: S0 / Docker, WSL, Crabbox permanently held; S1 deferred.
- D-117: command execution only in an explicitly selected remote cloud sandbox; no host/local fallback. Cloud-hosted model testing is the target.
- D-118: Vercel Sandbox selected as the first provider.
- D-115: research/sample prototype; no distribution or release artifact.
- D-116 D3 / D-109: three demo sessions are qualitative; scoring requires 10+ genuine sessions and owner labels hashed before scorer output.

## Implementation and acceptance

| Area | Current disposition |
|---|---|
| Core harness, profiles, tools, retrieval, memory, orchestration, policy | Implemented and automated-test covered; live model behavior is separate |
| Vercel adapter | Implemented; fake-client tested; not live-verified |
| Vercel SDK dependency | Present in root manifest/lockfile; dependency audit is currently failing |
| Workspace transfer | Not implemented |
| Result synchronization | Not implemented |
| Provider lifecycle audit | Incomplete |
| Profile/CLI integration | Not implemented; `COMMAND_TOOL` remains filtered |
| S0 | PERMANENT-HOLD |
| S1 | DEFERRED-S0-HOLD |
| S3 | CLOSED for file-tool/policy acceptance only |
| S4 | OPEN, cloud-only, not passed |
| S5 / ENG-04 | OUT OF SCOPE |
| S6 | OPEN under D-109 |
| S7 | OPEN / reconcile historical live evidence with current main |
| R3 demo | NOT STARTED |

## Next actions

1. Resolve the nested Zod security advisory without suppressing npm audit or forcing an unverified SDK downgrade.
2. Implement secret-safe project snapshotting and bounded transfer.
3. Implement path/hash validation and conflict-safe result synchronization.
4. Add lifecycle audit, redaction, timeout/cancel, and verified cleanup behavior.
5. Integrate Vercel into the profile/CLI only after those controls pass.
6. Complete live cloud acceptance, then reconcile S6/S7 and demo evidence.
7. Enable and verify branch protection requiring PRs and `ci-pass`.

See [STATE.md](STATE.md) for the active source of truth, [ROADMAP.md](ROADMAP.md) for phase exit criteria, and [BUILD-PLAN.md](BUILD-PLAN.md) for the checklist.
