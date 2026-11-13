# Component: sandbox

> Area type: bundle. Location: `src/bundles/sandbox/`. This guide describes the provider contract.

## Purpose

Defines the provider-neutral remote sandbox interface used by command-capable tools. It standardizes capability reporting, health checks, command results, and lease lifecycle without selecting a concrete provider.

## Route

A concrete provider registers through the shared sandbox service as `ctx.sandbox`. The command tool delegates to this service. The service enforces remote project consent and the exact provider-host allowlist before provider contact.

## Config and invariants

- The caller must explicitly select a remote provider. No auto-detection, local runtime, or host fallback.
- Commands use argv, not a shell string.
- Provider results distinguish command failure, timeout, cancellation, and lifecycle failure.
- Cleanup must be confirmed. A lease that cannot be confirmed deleted is not a successful command.
- Sandbox egress consent is separate from model-provider egress consent.
- Sandbox network access defaults to deny-all and needs a separate policy for any allowed destination.
- Policy gates, immutable approvals, hard denials, and audit logging remain mandatory.

## Known limits

- D-110 permanently holds the Docker/WSL/Crabbox S0 route; S1 is deferred.
- D-118 selects Vercel Sandbox as the first cloud provider, but the project workflow is not integrated or live-accepted.
- Do not enable `COMMAND_TOOL` until workspace transfer, safe result synchronization, lifecycle audit, and policy integration pass.
- See [STATE.md](../STATE.md) and [ROADMAP.md](../ROADMAP.md).

---
**Next:** Return to [context.md](../../context.md).
