# Component: subprocess

> Area type: bundle. Location: `src/bundles/subprocess/`. This guide describes the local process service.

## Purpose

Runs a local child process with explicit argv, working directory, environment allowlist, timeout, and output limits. It returns structured completion results for expected process failures rather than throwing for every non-zero exit.

## Route (how control reaches it)

A host explicitly installs the service as `ctx.subprocess`. Callers use `run(command, args, options)`. The service uses Node child-process spawning without an implicit shell and tracks live process trees so cancellation, timeout, and process exit can terminate descendants.

## Config surface and invariants

- `cwd` sets the default working directory.
- `envAllowlist` controls which environment variables may be passed.
- `timeoutMs` defaults to no timeout; `maxOutputBytes` defaults to 1,000,000.
- Per-call environment keys must be included in the configured allowlist.
- Command arguments are passed separately; the service does not interpret a shell command string.
- Expected spawn, timeout, signal, and exit failures are represented in the result.

## Known limits

- This is host subprocess execution, not a sandbox.
- The governed coding CLI does not expose it as a command tool under D-110.
- Process-tree cleanup is best effort and platform-specific.
- See D-110 and the command execution scope in `docs/status.md`.

---
**Next:** Return to [`context.md`](../../context.md).
