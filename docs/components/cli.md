# Component: cli

> Area type: support. Location: `src/cli/`. Hand-written sections describe the entry points and their invariants; generated source details are maintained by `npm run docs:components`.

## Purpose

Provides the terminal entry point and task lifecycles for ordinary runs, governed coding tasks, and the interactive wizard. The coding path validates the project root and task, obtains remote-provider consent when needed, boots the coding profile, checks sandbox availability, and runs the planner and executor.

The host Docker capability check lives in `docker.ts`. The governed coding lifecycle remains in `code.ts`; its exported `dockerEngineAvailable` name is re-exported there for compatibility.

## Route (how control reaches it)

The package CLI entry point in `index.ts` parses the `run` and `code` subcommands and dispatches to `runTask` or `runCodeTask`. The default command starts the wizard. `runCodeTask` is also used directly by integration tests and embedding callers.

## Config surface and invariants

- The `code` command accepts Ollama or OpenRouter, an optional base URL, project ID, sandbox mode, Ollama timeout, and optional Ollama text-tool-call recovery.
- OpenRouter requires `OPENROUTER_API_KEY`, an HTTPS endpoint without embedded credentials, and explicit per-project remote egress consent.
- The CLI offers `run_command` only after the configured sandbox provider's doctor check succeeds. Otherwise command execution is withheld; there is no host fallback.
- Docker capability detection uses a bounded 4-second `docker info` invocation with `shell: false`.
- `parseTimeoutMs` accepts only positive safe integer milliseconds up to 4,294,967,295.

## Known limits

- Docker availability is a capability signal, not proof that a sandbox workload can execute safely.
- A passing CLI test suite does not satisfy the real S0 sandbox acceptance gate.
- D-110 remains a permanent hold on Docker/WSL acceptance probes and workarounds. This component extraction does not run Docker or WSL commands.
- The CLI is a process entry point; callers embedding the profile directly should use the profile APIs rather than invoking CLI lifecycle helpers.

---
**Next:** Return to [`context.md`](../../context.md).
