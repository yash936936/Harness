# Component: sandbox-cubesandbox

> Area type: bundle. Location: `src/bundles/sandbox-cubesandbox/`. This guide describes the experimental adapter.

## Purpose

Adapts the CubeSandbox client to the shared sandbox provider contract. It is an alternative implementation kept separate from the common sandbox interface.

## Route (how control reaches it)

An explicit host integration installs the CubeSandbox adapter and exposes it through the shared sandbox service. Tools-local can then delegate commands through that service. The governed CLI does not probe or install this adapter.

## Config surface and invariants

- Client, workspace, and execution settings are adapter-specific.
- Provider errors and execution results must preserve the shared contract.
- The adapter must not introduce a host-execution fallback.
- Sandbox availability must never be inferred from a successful package import.

## Known limits

- CubeSandbox is experimental and is not the accepted S0 execution path.
- D-110 prohibits attempting an alternative sandbox as a workaround for the permanent S0 hold.
- No real-provider acceptance is claimed by unit tests or source presence.
- See D-110, D-112, and `docs/status.md`.

---
**Next:** Return to [`context.md`](../../context.md).
