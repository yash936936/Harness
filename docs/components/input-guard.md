# Component: input-guard

> Area type: bundle. Location: `src/bundles/input-guard/`. This guide describes the current implementation.

## Purpose

Treats successful tool output as untrusted input before it returns to the model. It wraps eligible results in a per-call nonce fence, scans a bounded prefix for instruction-like patterns, and records flagged results in the session log.

## Route (how control reaches it)

The coding profile installs `InputGuard` with the session log and tool registry. A post-execution hook sees successful tool results, scans and wraps them, and returns the wrapped content. Tools that already provide their own fencing or intentionally return trusted skill instructions are skipped by default.

## Config surface and invariants

- `skipTools` defaults to `search_code`, `read_skill_resource`, and `load_skill`.
- `maxScanChars` defaults to 200,000 leading characters.
- The random nonce is generated per call so content cannot predict the closing fence.
- A flagged result remains data inside the fence; it does not change tool permissions.
- The logged wrapped result is the same content passed onward to the model.

## Known limits

- Pattern scanning is heuristic and can miss indirect, encoded, or novel prompt injection.
- A fence is a prompt-format convention, not a security boundary.
- Policy gates and tool grants enforce actions independently of this detector.
- See D-083 and the prompt-injection notes in `docs/status.md`.

---
**Next:** Return to [`context.md`](../../context.md).
