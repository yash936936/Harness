# Component: cli

> Area type: support. Location: `src/cli/`. Hand-written sections describe the entry points and their invariants; generated source details are maintained by `npm run docs:components`.

## Purpose

Provides the terminal entry point and task lifecycles for ordinary runs, governed coding tasks, and the interactive wizard. The governed coding path validates the project root and task, obtains remote-provider consent when needed, boots the coding profile, withholds command execution under D-110, and runs the planner and executor.

## Route (how control reaches it)

The package CLI entry point in `index.ts` parses the `run` and `code` subcommands and dispatches to `runTask` or `runCodeTask`. The default command starts the wizard. `runCodeTask` is also used directly by integration tests and embedding callers.

## Config surface and invariants

- The `code` command accepts Ollama or OpenRouter, an optional base URL, project ID, the explicit `--sandbox none` compatibility option, Ollama timeout, and optional Ollama text-tool-call recovery.
- Sandbox mode defaults to `none`; any other value is rejected. D-110 prohibits Docker, WSL, and Crabbox probes, including capability checks.
- `run_command` is never offered by the CLI. There is no host-command fallback.
- OpenRouter requires `OPENROUTER_API_KEY`, an HTTPS endpoint without embedded credentials, and explicit per-project remote egress consent.
- `parseTimeoutMs` accepts only positive safe integer milliseconds up to 4,294,967,295.

## Known limits

- Governed coding tasks can use file tools, but cannot execute project commands while D-110 remains in force.
- A passing CLI test suite does not satisfy the real S0 sandbox acceptance gate.
- The removed Docker capability probe must not be reintroduced unless the owner explicitly supersedes D-110 with a new decision.
- The CLI is a process entry point; callers embedding the profile directly should use the profile APIs rather than invoking CLI lifecycle helpers.

---
**Next:** Return to [`context.md`](../../context.md).
