# Component: sandbox

> Area type: bundle. Location: `src/bundles/sandbox/`. This guide describes the provider contract.

## Purpose

Defines the sandbox provider interface used by command-capable tools. It standardizes capability reporting, health checks, execution results, and lifecycle operations without choosing a concrete sandbox implementation.

## Route (how control reaches it)

A concrete provider registers the sandbox service as `ctx.sandbox`. The tools-local command factory delegates command execution to this service. The caller remains responsible for deciding whether the command tool is offered at all.

## Config surface and invariants

- Providers must implement the shared lifecycle and command result contract.
- Command execution must stay inside the provider boundary; callers must not add host-process fallback.
- Results distinguish execution failure from provider or lifecycle failure.
- Lease cleanup and release status must be verified rather than inferred from a missing listing entry.

## Known limits

- A provider interface does not prove a real sandbox is configured or accepted.
- S0 / ARCH-01 is on permanent hold under D-110. The governed CLI must not probe or invoke sandbox providers.
- Do not run Docker, WSL, Crabbox, or substitute host execution while D-110 remains in force.
- See D-110, D-112, and `docs/status.md`.

---
**Next:** Return to [`context.md`](../../context.md).
