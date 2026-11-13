## 2026-11-14 documentation consolidation baseline

This entry is the current session status. Earlier dated entries below are retained as historical records and must not be treated as current instructions where they conflict with the latest decisions.

- Reviewed all 71 Markdown files present on main at baseline commit `50d0bb139f0103012de6bf36d48a0f1ee67e1126`.
- D-117 authorizes command execution only through an explicitly selected remote cloud sandbox. D-110 still permanently holds Docker/WSL/Crabbox S0 and prohibits host execution.
- D-118 selects Vercel Sandbox as the first cloud provider. Its adapter is implemented with fake-client tests, but no project workspace transfer, result synchronization, lifecycle audit, CLI/profile registration, or live end-to-end acceptance is complete. `COMMAND_TOOL` remains disabled.
- The latest observed CI run (#613) is red because `npm audit --omit=dev --audit-level=high` reports a high-severity Zod dependency in the Vercel SDK dependency tree. Do not suppress the audit or force-downgrade the SDK.
- S4 is open as cloud-only acceptance, not passed. S6 and S7 remain open/reconciliation-required. S0 is permanently held; S1 is deferred. S5 and distribution are out of scope.
- GitHub reports branch protection disabled. Owner action remains required to protect `main` and require `ci-pass`.

The ordered next actions are in [docs/BUILD-PLAN.md](BUILD-PLAN.md). The full scope and exit criteria are in [docs/ROADMAP.md](ROADMAP.md), and the single current state table is [docs/STATE.md](STATE.md).

---
