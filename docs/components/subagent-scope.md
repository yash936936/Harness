# Component: subagent-scope

> Area type: bundle. Location: `src/bundles/subagent-scope/`. This guide describes the current implementation.

## Purpose

Creates short-lived sub-agent scopes with explicit tool grants and actor identities. It enforces grants both in the tools offered to the sub-agent and in a pre-execution hook, and revokes descendant scopes when a parent closes.

## Route (how control reaches it)

The coding profile installs `SubagentScope` as `ctx.subagents`. The orchestrator calls `spawn()` with a sub-agent specification. The scope service delegates work to agent-loop and records open/close events in the session log. When memory is present, it creates and revokes actor-scoped memory grants.

## Config surface and invariants

- Sub-agent IDs are 1-64 characters from letters, digits, underscore, and hyphen.
- A child's tool grant must be a subset of its parent's grant; grants are not inherited implicitly.
- Actors in the `subagent:` namespace without a live scope are denied.
- Every ancestor must remain open for a descendant scope to remain valid.
- Closing a scope closes descendants and revokes their memory grants.

## Known limits

- A grant limits tools, not the correctness of model-generated arguments.
- Prompt instructions do not replace the pre-execution grant check.
- Memory integration is optional and must not be assumed when the memory bundle is absent.
- See D-068 and D-073.

---
**Next:** Return to [`context.md`](../../context.md).
