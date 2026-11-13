# Component: tool-registry

> Area type: bundle. Location: `src/bundles/tool-registry/`. Generated source details are maintained by `npm run docs:components`.

## Purpose

Owns the single execution boundary for registered tools. It validates and normalizes inputs, enforces caller grants and required call order, invokes policy hooks, runs the tool, scans and bounds results, and records audit events.

The service remains one module because these stages form one enforcement choke point. Type contracts and errors live in `types.ts`.

## Route

Profiles install `ToolRegistry`. Tool-producing bundles register definitions through `ctx.tools.register()`. The agent loop and orchestrator execute only through `ctx.tools.call()`.

## Config and invariants

- `maxOutputChars` bounds tool output.
- Tool definitions and schemas are cloned/frozen at registration. Call inputs are cloned/frozen before policy and execution.
- The original input and any canonical normalized input are logged.
- `allowedTools` and `requiredToolSequence` are enforced before policy hooks and execution.
- Hooks run serially. A pre-hook failure blocks execution; a post-hook failure withholds output.
- Log failures are infrastructure failures, not recoverable tool results.

## Known limits

- JSON schema validates shape, not operation safety; policy gates remain authoritative.
- Action-class meaning is enforced by the policy bundle.
- Output limits count characters, not tokens.
- Scripted tests do not prove live-model behavior or live cloud acceptance.
- Commands remain unavailable through the CLI until D-118 workspace transfer, result synchronization, lifecycle audit, and policy integration are complete.
