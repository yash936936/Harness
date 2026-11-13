# Component: router

> Area type: bundle. Location: `src/bundles/router/`. This guide describes the current implementation.

## Purpose

Selects a bounded tool-routing strategy for an agent step. It can use configured routing backends or a deterministic suite, then returns a candidate decision for the agent loop to apply within the caller's existing tool grant.

## Route (how control reaches it)

The profile installs the router as `ctx.router`. Agent-loop may consult it for the first read-only tool choice. Router backends and suite evaluation are implemented separately from the agent-loop; the loop remains responsible for enforcing the allowed tool set.

## Config surface and invariants

- Backend and suite configuration is explicit.
- Routing output can narrow the offered read-only tools but cannot add tools outside the caller's grant.
- Invalid or unavailable routing results must not widen permissions.
- The routing decision is advisory to tool selection; tool-registry remains the execution boundary.

## Known limits

- Routing quality depends on backend/model output and the available evaluation suite.
- A routing score is not a policy approval.
- The router does not own tool execution or side-effect authorization.
- See D-006 and the router evaluation notes in `docs/status.md`.

---
**Next:** Return to [`context.md`](../../context.md).
