## 2026-11-14 documentation consolidation baseline

This entry is the current session status. Earlier dated entries below are retained as historical records and must not be treated as current instructions where they conflict with the latest decisions.

- The documentation consolidation baseline was main commit `81d7bf837254b8526b60aa240d6a31923647a890`. The separate codebase audit remains in progress on PR #92.
- D-117 authorizes command execution only through an explicitly selected remote cloud sandbox. D-110 still permanently holds Docker/WSL/Crabbox S0 and prohibits host execution.
- D-118 selects Vercel Sandbox as the first cloud provider. Its adapter is implemented with fake-client tests, but no project workspace transfer, result synchronization, lifecycle audit, CLI/profile registration, or live end-to-end acceptance is complete. `COMMAND_TOOL` remains disabled.
- Audit branch CI run `43516548037` passed on commit `30401b9267fbf5e2578b752f61ba802a2e1dba1c`, including Windows/Ubuntu, typecheck, lint, tests, docs drift, secret scan, dependency audit, and license inventory. A scoped override pins nested Zod to 4.6.7. Later documentation-only audit commits are being rechecked; main is unchanged until PR #92 merges.
- S4 is open as cloud-only acceptance, not passed. S6 and S7 remain open/reconciliation-required. S0 is permanently held; S1 is deferred. S5 and distribution are out of scope.
- GitHub reports branch protection disabled. Owner action remains required to protect `main` and require `ci-pass`.

The ordered next actions are in [docs/BUILD-PLAN.md](BUILD-PLAN.md). The full scope and exit criteria are in [docs/ROADMAP.md](ROADMAP.md), and the single current state table is [docs/STATE.md](STATE.md).

---
