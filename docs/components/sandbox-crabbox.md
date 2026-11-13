# Component: sandbox-crabbox

> Area type: bundle. Location: `src/bundles/sandbox-crabbox/`. This guide describes the adapter implementation, not an acceptance claim.

## Purpose

Adapts the Crabbox CLI and lease lifecycle to the shared sandbox provider contract. It translates provider operations and command results into the Harness sandbox interface.

## Route (how control reaches it)

A host that explicitly installs the Crabbox adapter registers it as the sandbox provider. Tools-local can then call the shared sandbox interface. The governed CLI does not install or probe this adapter under D-110.

## Config surface and invariants

- Crabbox executable and workspace settings are adapter configuration, not a host fallback.
- Health and lease operations must report errors explicitly.
- A command result is accepted only after the provider lifecycle and release checks complete.
- Provider failure must not cause local process execution.

## Known limits

- S0 / ARCH-01 is on permanent hold under D-110 after the documented transport failures.
- Do not invoke Crabbox doctor, Docker, WSL, retries, or workarounds while the hold remains active.
- The adapter's presence in source is not evidence of a successful real sandbox run.
- See D-110 and `docs/evidence/S0-ARCH-01-TRANSPORT-INCIDENT-REPORT-2026-11-08.md`.

---
**Next:** Return to [`context.md`](../../context.md).
