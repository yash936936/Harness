# Dev workflow — Coding Harness

Root folder (identical across all tools): `D:\Users\yash\downloads\Harness`
(Git Bash: `/d/Users/yash/downloads/Harness`), opened in VS Code with the
Claude Code extension. Repository: `yash936936/Harness`, branch `main`.

## Current mode: Claude-only
Claude is the only tool in use. Claude writes, edits and checks the
implementation code, and also reviews it: after writing code, actually run
it, compare it with `docs/architecture.md` and `docs/phases.md`, and look for
bugs, rather than treating "wrote it" as "done". opencode is suspended, not
removed. It re-enters only when the owner says so explicitly ("switching to
opencode for X"). Do not assume a switch, and do not ask after every task.

## Session start (every session)
1. Read `context.md`, then `docs/status.md`.
2. Check `docs/decisions.md` (newest first) before proposing anything that
   might contradict a logged decision. Do not reopen one unless the owner does.
3. Check the working tree: `git status`, then `npm run typecheck` and
   `npm test`.

## Loop
1. Plan or design in chat when reasoning or a second opinion is needed; log
   resulting decisions in `docs/decisions.md` with the next `D-0NN` ID.
2. Implement the current sub-phase from `docs/phases.md`. One sub-phase at a
   time.
3. Run `npm run typecheck` and `npm test`. For opt-in live tests see the
   commands in `docs/readme.md`.
4. After each coding task: append to `docs/debug.md` (what was tested, what
   was not, what broke), update `docs/status.md`.
5. On completing a sub-phase: mark it in `docs/phases.md`. On completing a
   phase: update `docs/readme.md` to real, not aspirational, capabilities.
6. Commit and push from Git Bash. Keep bundle boundaries in `src/bundles/`
   matching `docs/architecture.md`; if the implementation drifts from that
   map, log a decision, not a silent change.

These logging steps are not optional because Claude is doing more of the
work. With no separate reviewer, hold them more strictly.

---
**Next:** Return to [`context.md`](../context.md).
