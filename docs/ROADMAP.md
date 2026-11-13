# Roadmap: cloud-executing research prototype

Updated 2026-11-14. This is the only active implementation roadmap. For current blockers and exact state, see [STATE.md](STATE.md). Owner decisions are in [decisions.md](decisions.md). Historical proposals are not active instructions.

## Target outcome

Given an explicitly selected project and task, Harness plans work, reads and edits project files, runs approved development commands in a remote cloud sandbox, collects changes safely, and returns an auditable result.

**Execution boundary:** remote cloud sandbox only. No host subprocess, local sandbox, automatic provider selection, or fallback. D-110 permanently holds Docker/WSL/Crabbox S0. D-118 selects Vercel Sandbox as the first provider.

## Security invariants

- Model-provider and sandbox-provider egress are separate destinations. Each requires explicit project consent and a host allowlist.
- Sandbox network is disabled by default. Any package-registry access needs a separate explicit network policy.
- Use argv only; no implicit shell, pipes, redirects, or command substitution.
- Use short-lived, non-persistent workspaces with resource, time, process, disk, and output limits.
- Never transfer host credentials, model keys, SSH agents, sockets, or credential stores into the sandbox.
- Exclude secrets and sensitive paths from project snapshots. Reject symlink escapes and path traversal.
- Collect remote results as bounded, path-validated changes. Detect conflicts; never blindly overwrite local work.
- Keep policy classification, immutable approvals, hard denials, redaction, audit logging, and verified cleanup fail-closed.
- A cleanup failure is a failed task, not a successful command.

## Work phases

| Phase | Goal | Exit evidence |
|---|---|---|
| 0. CI/security baseline | Keep dependency security and cross-platform CI green without weakening policy or breaking SDK compatibility. | Audit branch passed clean install, npm audit, typecheck, lint, tests, docs drift, license inventory, and `ci-pass` on 2026-11-14; re-run after subsequent audit changes. |
| 1. Workspace snapshot | Build a deterministic, secret-safe project archive and manifest. | Tests for secret exclusion, symlink/path traversal, size/count limits, stable hashes, and safe Git metadata. |
| 2. Result synchronization | Collect and validate remote changes and apply them safely. | Tests for traversal, symlink, conflict, truncation, tampering, and no-overwrite behavior. |
| 3. Lifecycle audit | Add structured provider and command lifecycle events. | Tests for event ordering, redaction, timeout/cancel, failed command, and failed cleanup. |
| 4. Provider/profile integration | Register Vercel explicitly; retain the provider-neutral contract. | No provider auto-detection; command tool remains unavailable without explicit provider and all controls. |
| 5. Cloud model verification | Verify OpenRouter path and separately test any additional cloud provider auth/API. | Live model smoke with provider/model/host/hosting provenance. |
| 6. Staged cloud acceptance | Verify empty sandbox, workspace round-trip, policy cases, build/test, and cleanup. | Raw owner-run evidence and independent review. S4 remains open until this is complete. |
| 7. Prototype evaluation/demo | Complete S7 reconciliation, D-109 S6 evaluation, and three qualitative demo sessions. | Genuine logs, owner labels/hash before scoring, demo summary, measured cold start, Windows quickstart. |
| 8. Repository governance | Enable branch protection. | GitHub confirms required PR and `ci-pass` rules on main. |

## Acceptance rules

- A fake SDK client proves adapter behavior against the fake only.
- CI proves configured automated checks, not live cloud behavior.
- Provider smoke in an empty sandbox is not project-workflow acceptance.
- S4 closes only after a real project snapshot, command execution, result synchronization, policy evidence, secret checks, and verified cleanup pass.
- S6 scorer output follows D-109: at least 10 distinct genuine model-driven sessions, both owner labels, labels committed and hashed before scoring. Use 20+ if available. Report prototype-grade, not calibrated.
- Three demo sessions are qualitative only and cannot replace S6 scoring evidence.

## Explicitly out of scope

Docker/WSL/Crabbox S0 and dependent S1; host command execution; local execution fallback; Qwen 7B artifacts; package/release/distribution; desktop application; browser research; multi-user scale; CubeSandbox as a workaround; Langfuse; router ownership without measured evidence.

## Definition of done

The prototype is done only when the implementation phases have passed their tests, CI is green on supported platforms, live cloud acceptance is owner-reviewed, S6/S7 dispositions are evidence-backed, and held/deferred scope is clearly reported. Do not call the project production-ready.
