# Component: cli

> Area type: support. Location: `src/cli/`. Generated source details are maintained between the markers below.

## Purpose

Provides the terminal entry point for single-call model runs, governed coding tasks, and interactive setup. The governed coding path validates the project root and task, obtains model egress consent when needed, boots the coding profile, and runs the planner/executor over the registered tools.

## Route

The package entry point parses `run` and `code` subcommands and dispatches to the corresponding task lifecycle. `runCodeTask` is also used by integration tests and embedding callers.

## Config and invariants

- The current coding CLI does not register the Vercel provider and does not offer `COMMAND_TOOL`.
- D-117 permits command execution only in an explicitly selected remote cloud sandbox. Host execution and local fallback are prohibited.
- D-118 selects Vercel Sandbox, but the adapter is not ready for project tasks: workspace transfer, result synchronization, lifecycle audit, and policy integration remain incomplete.
- Do not re-enable command execution until the active roadmap's workspace, synchronization, audit, and policy gates pass.
- Remote model providers require environment-only credentials and project egress consent.
- Never place credentials in CLI arguments or files.

## Known limits

- The governed CLI currently supports policy-gated project file operations, not project build/test commands.
- A passing CLI test suite does not prove live provider or cloud sandbox acceptance.
- D-110 permanently prohibits Docker/WSL/Crabbox S0 work and host execution.
- See [STATE.md](../STATE.md) and [ROADMAP.md](../ROADMAP.md).

<!-- BEGIN GENERATED: do not edit between markers -->

### Files and exports

| File | Exports | Responsibility (first header-comment line) |
|---|---|---|
| `src/cli/code.ts` | `CodeProvider`, `CodeTaskOptions`, `CodeTaskResult`, `parseTimeoutMs` | Governed coding-task CLI lifecycle; sandbox execution remains disabled under D-110. |
| `src/cli/index.ts` | - | CLI process entry point and argument parsing. |
| `src/cli/io.ts` | `AskOptions`, `ConfirmOptions`, `WizardIO`, `TerminalIO` | **(no header comment)** |
| `src/cli/run.ts` | `RunArgs`, `RunDeps`, `RunResult` | **(no header comment)** |
| `src/cli/wizard.ts` | `ProviderKind`, `WizardDeps`, `WizardCompleted`, `WizardAborted`, `WizardResult`, `formatDoctorReport` | **(no header comment)** |

**Imports other areas:** `app-core`, `egress`, `model-adapter`, `model-store`, `policy-gates`, `profiles`, `retrieval-tools`, `session-log`, `tools-local`

**Tests:** (none matched by name)

<!-- END GENERATED -->

---
**Next:** Return to [context.md](../../context.md).
