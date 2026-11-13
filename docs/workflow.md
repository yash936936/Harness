# Development workflow

This repository may be edited through a local checkout or an authorized GitHub workflow. Do not assume a particular editor, coding assistant, operating system, or local path.

## Start

1. Read `context.md` and `AGENTS.md`.
2. Read `docs/STATE.md`, the newest `docs/status.md` entry, and `docs/FAILURE-LEDGER.md`.
3. Check relevant decisions and component guides.
4. Inspect branch and working-tree state before editing.

## Work loop

1. Identify the failing layer and state a testable hypothesis.
2. Reproduce with the smallest relevant test or command.
3. Add a regression test that fails before the fix.
4. Make one focused change.
5. Run the targeted test, typecheck, lint, and relevant docs checks. Run the full suite before proposing merge.
6. Update current state and the active build plan. Keep historical evidence append-only.
7. Open a PR to `main`; do not merge red CI.

## Cloud execution boundary

D-117 permits commands only in an explicitly selected remote cloud sandbox. D-118 selects Vercel Sandbox. The current provider adapter is not a complete project coding environment. Keep `COMMAND_TOOL` disabled until workspace transfer, safe result synchronization, lifecycle audit, and policy integration are complete. No Docker, WSL, Crabbox, host subprocess, or local fallback.

Model and sandbox egress are separate consent destinations. Do not pass host credentials or model keys into the sandbox. Keep sandbox networking disabled unless a separate allowlist policy is approved.

## Evidence and handoff

Distinguish source presence, unit tests, CI, live smoke, and owner acceptance. Never infer one from another. Record technical findings in `docs/debug.md`, decisions in `docs/decisions.md`, and the current state in `docs/status.md`. The event log remains append-only.

At handoff, list changes, exact verification, what was not tested, remaining blockers, and the next action.
