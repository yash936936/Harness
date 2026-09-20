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

## Tool call pipeline (`ToolRegistry.call`)
**Where:** `src/bundles/tool-registry/index.ts`
**What it does:** log `tool.call` -> lookup -> validate input (JSON Schema)
-> `tools/pre-execute` -> execute -> `tools/post-execute` -> log
`tool.result` -> return.
**Why it's non-obvious:** (1) Order matters: the call is logged before
anything can run, and the result is logged before it can be returned, so a
log failure stops the call rather than leaving an unaudited one. (2) Hooks
fail closed: a crashing pre-hook blocks the call and a crashing post-hook
withholds the output. (3) Tool-level failures are returned as
`{ ok:false }`, not thrown; only infrastructure failures (log write) throw.
(4) Hooks get a deep-frozen copy of the input so a hook can't change what
executes.

## Model call logging (`LLMService.complete`)
**Where:** `src/bundles/model-adapter/index.ts`
**What it does:** appends `model.request` before calling the provider and
`model.response`/`model.error` after; `sessionId` is a required field.
**Why it's non-obvious:** it is the only place model calls are logged, so
the agent loop (1.5) must not log them again (D-016).

---
**Next:** Return to [`context.md`](../context.md).
