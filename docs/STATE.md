# Current project state

Updated 2026-11-14. This is the single compact source of truth for current scope, implementation status, blockers, and next work. Older status entries and audit snapshots are historical.

## Binding decisions

| Decision | Current rule |
|---|---|
| D-110 | S0 / Docker, WSL, Crabbox is PERMANENT-HOLD. S1 is deferred. No probes, retries, or workarounds. |
| D-117 | Development commands may run only in an explicitly selected remote cloud sandbox. No host/local fallback. Cloud-hosted model testing is the target. |
| D-118 | Vercel Sandbox is the first cloud provider. The provider-neutral sandbox interface remains. Selection does not mean integration or acceptance. |
| D-116 D3 / D-109 | Three demo sessions are qualitative. Scoring requires 10+ genuine sessions (20+ if available), owner-authored good/bad labels committed and hashed before scoring. |
| D-115 | Sample/research prototype only. No package, release, hosted distribution, or model-weight distribution. |
| D-114 | Qwen 7B artifact work is excluded. The old 3B-only testing restriction is superseded only by D-117's cloud-hosted testing scope. |

## Current implementation

| Area | State | Boundary |
|---|---|---|
| Core harness, profiles, tools, policy gates, retrieval, memory, orchestrator | Implemented; CI-tested | Does not establish live model quality or external acceptance. |
| Sandbox service and provider contract | Implemented | Provider presence is not live execution proof. |
| Vercel Sandbox adapter | Implemented, fake-client tested | Requests non-persistent, deny-all sandbox; argv command; delete in cleanup. Not live-verified. |
| Vercel SDK dependency | Scoped override pins nested `@vercel/cli-config` Zod to 4.6.7 | `npm audit --omit=dev --audit-level=high` passes on the audit branch; no audit suppression or SDK downgrade. |
| Project workspace transfer | Not implemented | No project files are currently transferred to the Vercel sandbox. |
| Result synchronization | Not implemented | No remote changes are safely collected/applied to the local project. |
| Provider lifecycle audit | Incomplete | Add events for request, lease, command, timeout/cancel, cleanup, and failures. |
| Coding profile/CLI provider selection | Not integrated | `COMMAND_TOOL` remains filtered. Do not enable it. |
| Cloud model authentication | Partially verified | OpenRouter-compatible path exists. Ollama cloud authentication/API compatibility is unverified. |

## Acceptance state

| Gate | State | Required evidence |
|---|---|---|
| S0 | PERMANENT-HOLD | No further work under D-110. |
| S1 | DEFERRED | Depends on S0. |
| S3 | CLOSED (D-111) | File-tool/policy acceptance only. No sandbox acceptance implied. |
| S4 | OPEN, CLOUD-ONLY PLAN | Complete governed project workflow in Vercel Sandbox with live evidence. Not passed. |
| S5 / ENG-04 | OUT OF SCOPE (D-115) | Reopen only if distribution is approved. |
| S6 | OPEN | D-109 genuine-session and owner-label requirements. |
| S7 | OPEN / RECONCILE | Reconcile historical live embedding/poisoning evidence with current main; rerun only missing or stale checks. |
| R3 demo | NOT STARTED | Three qualitative sessions, reviewed summary, measured cold start, Windows quickstart, demo script. |

## Current CI and repository controls

- Main baseline for the audit branch: `81d7bf837254b8526b60aa240d6a31923647a890`.
- Audit branch CI run `43516548037` passed on commit `30401b9267fbf5e2578b752f61ba802a2e1dba1c`: Ubuntu and Windows install, typecheck, lint, and tests; docs/component drift; secret scan; dependency audit; and license inventory. The run does not update `main`; PR #92 remains a draft and unmerged.
- GitHub reports `main.protected=false`. The owner must enable PR-only merging, require `ci-pass`, require up-to-date branches, block force pushes/deletions, and disable admin bypass.

## Ordered moving-forward plan

1. **Keep the CI/security baseline green.** The nested Zod advisory is resolved on the audit branch with a scoped `@vercel/cli-config` override to 4.6.7. Re-run all checks after remaining audit changes; do not suppress audit or downgrade the Vercel SDK.
2. **Complete workspace transfer design.** Define a deterministic project snapshot, exclude secrets and sensitive paths, reject symlinks/path traversal, bound file count/size, and preserve Git metadata safely.
3. **Implement safe result synchronization.** Collect a bounded patch/result manifest, validate paths and hashes, detect local conflicts, and apply only after policy/approval. Never overwrite unrelated local changes.
4. **Add lifecycle audit and failure handling.** Log consent, provider host, lease, command argv/cwd, approval, timestamps, exit, bounded redacted output, timeout/cancel, and verified cleanup. Cleanup failure is task failure.
5. **Integrate provider explicitly.** Register Vercel in the coding profile and CLI only after steps 2-4 pass. Keep the command tool unavailable otherwise. No fallback.
6. **Verify cloud model path.** Keep OpenRouter as the current compatible route. Verify Ollama cloud auth/API before adding it to acceptance. Record provider, model, endpoint host, and hosting class.
7. **Run staged acceptance.** Provider smoke in empty sandbox, workspace round-trip, approved/denied/hard-denied command cases, full build/test workflow, cleanup failure, and secret-leak tests. CI and fakes are not live acceptance.
8. **Close S6/S7 and demo evidence.** Follow D-109 for scoring. Reconcile existing S7 evidence and run only missing current-main checks. Produce the three qualitative demo sessions separately.
9. **Owner repository action.** Enable branch protection and verify required `ci-pass`.

## No-go list

Do not probe Docker, WSL, Crabbox, or use host execution. Do not enable `COMMAND_TOOL` while workspace transfer/result sync/audit are incomplete. Do not pass credentials into the sandbox. Do not weaken policy gates or silence npm audit. Do not fabricate live evidence, sessions, labels, or measurements. Do not create release/distribution work under D-115.

## Evidence vocabulary

Use **implemented**, **unit-tested**, **CI-verified**, **live-smoke-tested**, and **owner-accepted** precisely. A status can advance only with the corresponding evidence.
