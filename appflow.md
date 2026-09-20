# App flow — Coding Harness

> "User" here is whoever submits a task to the harness (the project owner,
> via opencode or a direct API call) — there's no separate end-user product
> surface defined in the design doc yet. Flows below are the harness's own
> operational paths, derived from the guardrail/orchestration design in
> `docs/architecture.md`.

## Task submission and autonomous execution
1. User submits a task to the orchestrator.
2. Orchestrator plans and spawns one or more scoped sub-agents.
3. Each sub-agent runs its ReAct loop: reason → retrieve context (if
   needed) → call a tool.
4. Read-only actions (search, grep, retrieval, browsing) and sandbox-scoped
   writes execute autonomously, logged to the session log.
5. Orchestrator returns the result to the user once all sub-agents
   complete or the task is otherwise resolved.

## Real-filesystem write requiring approval
1. A sub-agent proposes a write outside the sandbox/scratch workspace.
2. `tools/pre-execute` checks the action's confidence score
   (self-reported, cross-checked against an independent heuristic).
3. If confidence is at/above threshold: allowed, logged, execution continues.
4. If below threshold: held, an approval-pending event is written to the
   session log, and the user is prompted.
5. User approves or denies; the resolution is itself logged.
6. On approval, the write executes; on denial, the sub-agent replans.

## External research via the browser tool
1. Sub-agent requests browser access (`ctx.browser`, via agent-browser).
2. Domain allowlist is checked — only approved domains are reachable by
   default.
3. Fetched page content is wrapped in content-boundary markers before it
   reaches the model, and passed through a prompt-injection pattern check.
4. If the sub-agent wants to reach a domain outside the allowlist, that's
   itself a policy-gated action requiring approval.
5. Post-hoc scan checks the sub-agent's output for accidental secret
   leakage before it's surfaced to the orchestrator or user.

## Deny-listed action (hard stop)
1. A sub-agent attempts an action matching the deny-list (prod credentials,
   `rm -rf`, force-push, or a wrapped/aliased equivalent).
2. `tools/pre-execute` rejects it immediately — hard stop, no
   confidence-threshold override possible.
3. The rejection is logged to the session log as a first-class event,
   visible in the same audit trail as successful actions.

---
**Next:** Return to [`context.md`](../context.md).
