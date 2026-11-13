# Component: orchestrator

> Area type: bundle. Location: `src/bundles/orchestrator/`. Generated source details are maintained by `npm run docs:components`.

## Purpose

Plans a task as bounded, ordered subtasks and executes each in a short-lived sub-agent with an explicit tool grant. Planning output is validated before execution; the executor re-validates against the caller's allowed-tool ceiling and records state transitions.

Dependency-result fencing and worker prompt construction live in `prompt.ts`. Sequential execution remains in `execute.ts`. Shared model-independent plan validation and explicit-tool normalization are composed in `plan.ts`.

## Route

The coding profile installs `Orchestrator`. Callers use `ctx.orchestrator.plan()` and `ctx.orchestrator.execute()`. Execution delegates to sub-agents through `ctx.subagents`.

## Config and invariants

- Planner limits bound subtask count, tool grants, goal length, and IDs.
- Dependencies may reference only earlier subtasks; execution is sequential.
- Caller `allowedTools` is the ceiling. Every tool must be registered and allowed before execution.
- Retries are bounded and occur only when the failed attempt made no side-effecting tool call.
- Dependency results are bounded and fenced as data, not instructions.
- Model-produced and caller-supplied plans use the same normalization pipeline.
- Required tool sequences are prerequisites to the overall answer. Downstream synthesis depends on every required call.
- Every subtask receives a terminal status; missing audit events are surfaced.

## Known limits

- Scripted tests do not establish live model task quality.
- Prompt fencing is not authorization.
- Cloud command execution is not enabled in the CLI. D-117/D-118 require remote cloud sandbox execution only, and the Vercel workspace/result lifecycle is incomplete.
- D-110 permanently holds the separate Docker/WSL/Crabbox S0 route; this does not prohibit the separately approved cloud route.
- See [STATE.md](../STATE.md).

---
**Next:** Return to [context.md](../../context.md).
