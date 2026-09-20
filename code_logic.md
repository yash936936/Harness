# Code logic — Coding Harness

> No implementation exists yet (see `docs/status.md`). This file gets
> populated as non-obvious logic actually appears in code — not
> front-loaded with speculative design. The design doc's own pseudocode for
> the policy-gate dispatch is captured below since it's the one piece of
> logic detailed enough to be worth recording ahead of implementation.

## Policy-gate dispatch (`tools/pre-execute`)
**Where:** `src/bundles/policy-gates/` (once built — Phase 5)
**What it does:** On every tool call, matches the action's class against
the policy table and either allows, allows-and-logs, checks confidence
before holding for approval, always holds for approval, or hard-blocks:

```
tools/pre-execute:
  match action.class:
    read-only              → allow
    sandbox-scoped-write   → allow, log
    real-fs-write          → check confidence_score
                              if >= threshold: allow, log
                              else: hold, request approval
    external-side-effect   → hold, request approval (always)
    deny-listed            → reject, hard stop, log
```
**Why it's non-obvious:** The deny-list must be pattern-based (e.g. `rm -rf`,
force-push flags, credential-file paths), not command-name-based, or a
wrapped/aliased command bypasses it. The `real-fs-write` confidence score
must never be trusted alone — it's cross-checked against at least one
independent heuristic (file criticality, diff size, whether tests exist for
the touched path) before the threshold check runs. The
"always requires approval" and "hard block" branches have no
confidence-threshold override, by design — this is the one place in the
table that should never become conditional.

---
**Next:** Return to [`context.md`](../context.md).
