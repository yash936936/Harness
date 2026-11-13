# Component: tools-local

> Area type: bundle. Location: `src/bundles/tools-local/`. Generated source details are maintained between the markers below.

## Purpose

Registers project file tools and the sandbox-backed `run_command` tool factory. File access is confined to the configured project root. Command execution delegates only to the registered remote sandbox service.

The command factory lives in `command.ts`. Git read-command hardening remains in the service and uses the same sandbox seam.

## Route

`profile-coding` installs `LocalTools` with the project root and limits. The service registers tool definitions through `ctx.tools`. Calls pass through the tool registry and policy hooks. `run_command` delegates to `ctx.sandbox.run`; it must never invoke a host process.

## Config and invariants

- Root paths are resolved and confined before file access.
- Reads and outputs are bounded. Secret reads default to false; `.git` internals are inaccessible through file tools.
- Writes use atomic/exclusive operations and reject ambiguous edits.
- Path checks are defense-in-depth; the documented same-user parent-directory race remains a residual risk.
- Commands accept argv only and require a registered, explicitly selected remote provider.
- Missing provider, failed policy, timeout, cancellation, non-zero exit, or unconfirmed cleanup must not become success.
- The CLI currently keeps `COMMAND_TOOL` filtered. Do not expose it until workspace transfer, safe result synchronization, lifecycle audit, and policy integration are complete.

## Known limits

- D-110 prohibits Docker/WSL/Crabbox S0 work and all host command execution.
- D-117 permits only remote cloud sandbox execution; D-118 selects Vercel as the first provider.
- The Vercel adapter currently runs in an empty sandbox and does not synchronize project changes.
- `commandRisk` must be wired into policy signals; otherwise commands are held.
- See [STATE.md](../STATE.md) and [ROADMAP.md](../ROADMAP.md).

---
**Next:** Return to [context.md](../../context.md).
