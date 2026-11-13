# Component: agent-loop

> Area type: bundle. Location: `src/bundles/agent-loop/`. Hand-written sections describe the service and its invariants; generated source details are maintained by `npm run docs:components`.

## Purpose

Runs a bounded ReAct loop over `ctx.llm` and `ctx.tools`. It builds system prompts from registered sections, optionally routes the first read-only tool choice, enforces required tool sequences through the registry, retries retryable provider errors within configured limits, and returns the final transcript and stop reason.

The pure response classifiers used during required-sequence finalization live in `response-guards.ts`. They identify pseudo tool-call syntax and copied tool-result safety boilerplate so those strings cannot be accepted as the user's answer.

## Route (how control reaches it)

The coding and minimal profiles install `AgentLoop`. Callers use `ctx.agentLoop.run(options)`; the orchestrator spawns scoped sub-agents that call the same service. The loop delegates model requests to `ctx.llm.complete()` and tool execution to `ctx.tools.call()`.

## Config surface and invariants

- `maxSteps` bounds model calls per run.
- Provider fallback and retry settings are bounded; retry classification comes from `LLMError.retryable` and `retryAfterMs`.
- System sections are evaluated once per run, sorted by order and registration order.
- The router can only narrow the first-step read-only tool set; it cannot widen the caller's grant.
- Required tool-call attempts are enforced by the registry before policy hooks. Once the sequence is complete, no tools are offered for finalization.
- A final response that repeats pseudo tool-call syntax or tool-result warning boilerplate is re-prompted once, then fails closed if repeated.

## Known limits

- Response guards are bounded text heuristics, not general semantic answer validation.
- Provider retries do not prove model task correctness or tool safety; policy gates remain the side-effect enforcement layer.
- Scripted tests do not establish live-model compliance.
- Cloud command execution is not exposed by the CLI yet. D-117/D-118 require an explicitly selected remote cloud sandbox; D-110 permanently holds the separate Docker/WSL/Crabbox S0 route. D-114's 3B-only testing rule is superseded only for cloud-hosted testing under D-117.

---
**Next:** Return to [`context.md`](../../context.md).
