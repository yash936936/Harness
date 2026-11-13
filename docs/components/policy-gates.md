# Component: policy-gates

> Area type: bundle. Location: `src/bundles/policy-gates/`. This guide describes the current implementation.

## Purpose

Makes the side-effect decision for tool calls. It combines the tool action class, independent risk signals, model confidence, configured thresholds, and explicit approval to allow, hold, or deny an operation.

## Route (how control reaches it)

The coding profile installs the policy hooks before local tools are registered. Tool-registry invokes the pre-execution hooks for each call. The policy service evaluates the request and, when required, asks the configured approver for a decision tied to the exact operation.

## Config surface and invariants

- The default confidence threshold is 0.8; profile configuration cannot weaken it below the enforced floor.
- Independent risk signals are combined conservatively. Missing or invalid signals fail closed.
- External side effects and unknown or unsafe actions are held or denied according to the policy rules.
- Approval is scoped to the exact request and is not a blanket grant for later operations.
- Approval requests carry a deep-cloned, recursively frozen input snapshot. An approver cannot mutate the live tool input or silently change the operation after the approval prompt.
- Command risk must be wired into the profile; without it, command execution is held.

## Known limits

- Model self-reported confidence is not an independent safety signal.
- Heuristic risk classification can be incomplete; unknown actions must remain fail-closed.
- Policy tests prove deterministic decisions for fixtures, not safe live-model behavior.
- See D-006, D-110, and D-114.

---
**Next:** Return to [`context.md`](../../context.md).
