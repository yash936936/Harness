# Dev workflow — Coding Harness

Root folder (identical across all tools): `~/projects/coding-harness`
(open — confirm with user; no project path existed on disk at setup time,
this is a placeholder until confirmed).

Coding agent(s): `opencode` — run inside opencode's own environment,
against the project root above.

1. Plan/design changes in Claude (browser) when reasoning or a second
   opinion is needed; log resulting decisions in `docs/decisions.md`.
2. Open the project root in opencode; use `@docs/architecture.md` and
   `@docs/phases.md` as context to implement the current phase's bundles.
3. Run, test, and debug within opencode's own environment (same root as
   workspace); use git from there for commits/pushes.
4. After each coding task: append to `docs/debug.md`, update
   `docs/status.md`.
5. On completing a phase: update `docs/phases.md` status and
   `docs/readme.md` to reflect current real capabilities.
6. Because this project's own architecture is Cordis-based (bundles /
   plugins / profiles), keep bundle boundaries in `src/bundles/` matching
   `docs/architecture.md` exactly — if opencode's implementation drifts
   from that map, that's a decisions.md-worthy moment, not a silent change.

---
**Next:** Return to [`context.md`](../context.md).
