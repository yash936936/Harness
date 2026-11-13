# Component: policy-gates

> Area type: bundle. Location: `src/bundles/policy-gates/`. This guide describes the current implementation.

## Purpose

Makes side-effect decisions for tool calls. It combines action class, independent risk signals, confidence, configured thresholds, and explicit approval to allow, hold, or deny an operation.

## Route

The coding profile installs policy hooks before local tools. Tool-registry invokes pre-execution hooks for each call. Approval requests are bound to the exact operation.

## Config and invariants

- The default confidence threshold is 0.8; profile configuration cannot weaken the enforced floor.
- Independent risk signals are combined conservatively. Missing or invalid signals fail closed.
- External side effects and unknown or unsafe actions are held or denied according to policy.
- Approval is scoped to the exact request and carries a deep-cloned, recursively frozen input snapshot.
- Command risk must be wired into policy signals. A missing risk signal holds command execution.
- Hard-denied actions cannot be approved.

## Known limits

- Model self-reported confidence is not an independent safety signal.
- Heuristic risk classification can be incomplete; unknown actions remain fail-closed.
- Policy tests prove deterministic decisions for fixtures, not safe live-model behavior.
- D-117/D-118 require command execution only through the selected remote cloud sandbox. D-110 still holds Docker/WSL/Crabbox S0 and prohibits host execution.
- See [STATE.md](../STATE.md).

---
**Next:** Return to [context.md](../../context.md).
