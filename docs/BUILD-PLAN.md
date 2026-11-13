# Build plan

Updated 2026-11-14. This file is the short execution checklist. The full sequence and exit criteria are in [ROADMAP.md](ROADMAP.md); current evidence and blockers are in [STATE.md](STATE.md). Older runbooks and dated reports have been removed from this active plan and remain in their historical evidence files.

## Current work queue

- [x] **B0: Fix CI dependency audit.** A scoped npm override pins nested `@vercel/cli-config` Zod to 4.6.7 without `--force` or audit suppression. Audit branch CI run 43516548037 passed; main remains unchanged until PR #92 is merged.
- [ ] **B1: Workspace snapshot.** Define and implement deterministic project transfer. Exclude credentials/secrets, reject symlink/path traversal, bound size/count, and preserve only required Git metadata.
- [ ] **B2: Result synchronization.** Collect a bounded change manifest; validate paths and hashes; detect local conflicts; apply changes only through the governed write path.
- [ ] **B3: Lifecycle audit.** Add redacted events for consent, provider, lease, command, approval, timeout/cancel, result, and cleanup. Cleanup failure must fail the task.
- [ ] **B4: Explicit provider integration.** Register Vercel in the coding profile and CLI only after B1-B3 pass. Keep `COMMAND_TOOL` filtered until then.
- [ ] **B5: Cloud model verification.** Verify OpenRouter live behavior and check Ollama cloud auth/API before claiming compatibility.
- [ ] **B6: Staged acceptance.** Empty sandbox smoke, workspace round-trip, allow/deny/hard-deny cases, build/test, secret scan, cleanup failure, and owner review.
- [ ] **B7: S6/S7 and demo closeout.** Reconcile historical S7 evidence, run missing current-main checks, follow D-109 for scoring, and prepare three qualitative demo sessions.
- [ ] **B8: Branch protection.** Owner enables PR-only merge and required `ci-pass`, then verifies GitHub reports protection enabled.

## Guardrails

- D-110: no Docker, WSL, Crabbox, or host execution.
- D-117: cloud sandbox only; no local or host fallback.
- D-118: Vercel Sandbox is the first provider, not yet end-to-end accepted.
- Never enable `COMMAND_TOOL` before workspace transfer, result sync, audit, and policy tests pass.
- Do not weaken policy, suppress dependency audit, or fabricate acceptance evidence.
- D-115: no release/distribution work in this prototype.

## Completion reporting

Report implementation, unit tests, CI, live smoke, and owner acceptance separately. A green CI run or fake-client test is not live cloud acceptance.
