# Component: eval-runner

> Area type: bundle. Location: `src/bundles/eval-runner/`. This guide describes the current implementation.

## Purpose

Scores a completed session from its recorded events using deterministic scorers. It reports individual scorer outcomes, weighted aggregate score, required-check failures, and whether the configured threshold passed.

## Route (how control reaches it)

The profile installs `EvalRunner` as `ctx.eval`; it injects the session log. Callers invoke `ctx.eval.score(sessionId)`. Pure callers and tests can use `scoreEvents()` with an explicit event list and scorer set.

## Config surface and invariants

- The default aggregate threshold is 0.7 and must be between 0 and 1.
- Scorer names must be unique and non-empty.
- Weights must be finite and non-negative.
- A scorer exception or malformed result becomes a failed scorer outcome, not a silently skipped check.
- Extra scorers are added to the configured set unless the caller explicitly requests `only: true`.
- Required scorers must pass even when the aggregate score reaches the threshold.

## Known limits

- Event-based evaluation measures recorded behavior, not hidden model reasoning.
- Synthetic fixtures and labelled tests do not substitute for genuine owner-labelled sessions.
- A passing report is only as reliable as the event coverage and scorer definitions.
- See D-109 and the S6 acceptance status in `docs/status.md`.

---
**Next:** Return to [`context.md`](../../context.md).
