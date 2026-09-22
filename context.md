# Context — Coding Harness

> Entry point. Read this file first, every session, before touching code or
> any other doc. If you (the agent) jumped straight into another file, stop
> and come back here.

## What this project is
A multi-agent orchestration harness for coding tasks, built on Cordis (a
TypeScript plugin kernel for composable services/events). Every capability —
model access, tools, retrieval, memory, sandboxing, the browser — is a Cordis
bundle registered on a shared `ctx`. Profiles (`minimal` → `coding` →
`research` → `full`) compose bundles into runnable stacks, so the system
starts as a single agent with a session log and grows into a governed,
multi-agent, multi-user harness without rearchitecting. Model access is
provider-agnostic: local Ollama or any OpenAI-compatible cloud endpoint
(OpenRouter first), with consent required before anything leaves the machine.
Status: Phase 1 in progress; session-log, model-adapter (with the rate
limiter and consent gate) and tool-registry are built and tested. Next is
1.4 (subprocess). See `docs/status.md`.

## Folder structure
```
coding-harness/
├── context.md          ← you are here
├── docs/                the files below
│   ├── prd.md            product requirements — what & why
│   ├── trd.md            technical requirements — how, constraints
│   ├── architecture.md   full system/file structure — the map
│   ├── phases.md         build order, phase by phase
│   ├── decisions.md      append-only log of decisions made
│   ├── debug.md          append-only log of bugs found & fixed
│   ├── code_logic.md     non-obvious logic/algorithms explained
│   ├── appflow.md        user-facing flow through the app
│   ├── workflow.md       dev workflow across Claude/editor/coding agent
│   ├── readme.md         public-facing readme, updated as phases complete
│   └── status.md         current phase, last debug, last decisions — log every run
├── src/                  actual code (bundles under src/bundles/)
└── test/                 vitest tests, one file per bundle
```

Root folder on disk: `D:\Users\yash\downloads\Harness` (Git Bash:
`/d/Users/yash/downloads/Harness`). Repository: `yash936936/Harness`, `main`.

## Where to look, by task
| I need to...                          | Read this first          |
|----------------------------------------|---------------------------|
| Understand the product                 | `docs/prd.md`             |
| Understand technical constraints       | `docs/trd.md`              |
| Understand the file/system layout      | `docs/architecture.md`    |
| Know what to build next                | `docs/phases.md` + `docs/status.md` |
| Understand a tricky piece of logic     | `docs/code_logic.md`      |
| Understand how a user moves through it | `docs/appflow.md`         |
| Know the dev process/tooling loop      | `docs/workflow.md`        |
| See past decisions before changing something | `docs/decisions.md` |
| See what broke before and how it was fixed | `docs/debug.md`       |
| Know current state before starting work | `docs/status.md`         |

## Logging rules (every agent must follow these)
- Finished a coding task → append to `docs/debug.md` (what you tested, what
  broke, what you fixed) even if nothing broke ("no issues found").
- Made a design/implementation decision → append to `docs/decisions.md` with
  an ID (`D-00N`), what was decided, and why (alternatives considered if any).
- End of every work session/run → update `docs/status.md`: current phase,
  what changed, what's next.
- Completed a phase → update `docs/readme.md` to reflect current real
  capabilities (not aspirational ones) and mark the phase done in
  `docs/phases.md`.

## Roles: who writes the code
- **Current mode: Claude-only.** Claude writes and checks the implementation
  code, and also does the review: run it, compare it with
  `docs/architecture.md` and `docs/phases.md`, look for bugs. "Wrote it" is
  not "done".
- **opencode is suspended**, not removed. It re-enters only when the owner
  says so explicitly ("switching to opencode for X"). Do not assume a switch
  and do not ask after every task.
- Every session, including a new chat resuming this project: read this file,
  then `docs/status.md`, then check `docs/decisions.md` before proposing
  anything that could contradict a logged decision. `docs/workflow.md` has
  the working loop.

## Next task
1.5 (agent-loop) is done (D-023 retry/fallback, bounded reflection,
maxSteps). It uses `MockProvider` only, never `ctx.subprocess`, so it
doesn't depend on D-031. 1.6 (`profile-minimal` end-to-end wiring) is next
on `phases.md`, but is explicitly GATED on D-031 first: 1.4's env-allowlist
failed 3 of 5 security tests on the owner's Windows machine (11 system env
vars leaked to a child that should have seen none), not yet root-caused. A
runnable profile that shells out is exactly where that gap would matter.
Run `node scripts/diagnose-windows-env.cjs` on Windows and report the
output before starting 1.6.
Before the harness sends real code to a cloud provider,
Phase 1B.1 (redaction, secrets proxy, per-project opt-in) must exist (D-029).
Reference worker is local Ollama, `qwen2.5-coder:3b-instruct` (D-030);
Ornith-1.5 9B is confirmed not on OpenRouter. Open items for the owner: run
the Electron and Tauri measurement on the 8 GB machine; confirm the 3B model
runs at an acceptable speed and whether the 7B tag is also worth trying.
