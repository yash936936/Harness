# Component: tool-registry

> Area type: bundle. Location: `src/bundles/tool-registry/`. Hand-written sections describe the service and its invariants; generated source details are maintained by `npm run docs:components`.

## Purpose

Owns the single execution boundary for registered tools. Bundles register typed tool definitions with an action class and JSON input schema. Callers execute tools through `ctx.tools.call()`; the registry validates and normalizes inputs, enforces caller grants and required call order, invokes policy hooks, runs the tool, scans the result, bounds output, and records the audit events.

The service remains one module because these stages form one enforcement choke point. The type contracts and error classes live in `types.ts`.

## Route (how control reaches it)

The minimal and coding profiles install `ToolRegistry`. Tool-producing bundles register definitions with `ctx.tools.register()`. The agent loop and orchestrator call `ctx.tools.call()`; no model or bundle executes a tool definition directly.

## Config surface and invariants

- `maxOutputChars` bounds tool output before it reaches the model or session log; it must be a positive safe integer.
- Tool names are limited to 1-64 ASCII letters, digits, underscores, and hyphens.
- Every tool requires a description, one of the four action classes, an object JSON schema, and an execute function. Duplicate names are refused.
- Definitions and schemas are cloned and frozen at registration. Call inputs are cloned and frozen before policy and execution.
- The original input is logged in `tool.call`. If a tool normalizer changes it, the canonical input is recorded in `tool.input.normalized` and is the value validated, checked by policy, and executed.
- `allowedTools` and `requiredToolSequence` are enforced before policy hooks and execution.
- Pre-execution and post-execution hooks run serially. Any hook failure blocks the call or withholds its result.
- The registry writes `tool.call` before execution and `tool.result` before returning. A logging failure is infrastructure failure, not a recoverable tool result.

## Known limits

- JSON schema validates input shape, not whether the requested operation is safe; policy gates remain the side-effect enforcement layer.
- A tool action class is required at registration but the class's policy meaning is enforced by the policy bundle.
- Output truncation bounds characters, not tokens.
- Scripted registry tests do not establish live-model behavior or real sandbox acceptance. D-110 and D-114 remain unchanged.

---
**Next:** Return to [`context.md`](../../context.md).
