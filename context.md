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
multi-agent, multi-user harness without rearchitecting. Status: architecture
and bundle/profile breakdown are decided (see `docs/decisions.md`); no code
written yet — Phase 1 (`profile-minimal`) is the next concrete work.

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
└── src/                  actual code (not yet created)
```

Root folder on disk: `~/projects/coding-harness` (open — confirm with user;
no project path existed yet at setup time, so `docs/workflow.md` uses this
as a placeholder until the real path is confirmed).

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

## Roles: Claude vs. opencode
- **Claude** (browser or editor chat) reads and writes the docs, verifies
  what's actually true (does it run? does the code match what's claimed?),
  and decides/instructs what happens next. Claude does not write this
  project's implementation code by default.
- **opencode** writes and runs the actual code, using this doc system as its
  context. It is a plugin-based coding agent itself (built on Cordis's
  sibling ecosystem), which lines up with this project's own Cordis-based
  stack.
- This applies in every session, including a brand-new chat resuming this
  project — read this file and `docs/status.md` first, verify current
  state, then instruct opencode on the next concrete step.

## Next task
Sub-phase 1.4 — subprocess bundle (env allowlist security test is the key one).
See `docs/phases.md`.
