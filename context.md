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
Phases 1-3 done. Phase 4 STARTED: 4.3 `subagent-scope` built and Windows-verified (tools only; memory scoping open, D-069); 4.1 planner built (D-071), real-model plan validity unmeasured (`scripts/smoke-plan.ts`). Real-model run 2 (D-070) satisfied the
"some model calls tools" gate but NOT "uses memory/skills": hot rule no effect and load_skill 1/3 on both 3B models (n=3). Treat workers as weak.
Next: 4.2 executor (after the owner's smoke-plan output), then 4.4. Owner decisions pending: memory scoping
(scope key vs shared in v1) and which model plans (see `docs/status.md`).
D-068: `ToolContext.allowedTools` makes the registry refuse tools the caller was not offered; keep passing it from any new loop caller.
Known gaps: nothing writes lessons (D-064); compaction (D-064) and skills (D-065) are prompt-poisoning surfaces until Phase 5; memory, skills
and subagents are in no profile; a real model has never followed a hot rule. Rules learned: a bundle must declare every service it touches in
`static inject`; LanceDB tests need `vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })`; owner's shell is Git Bash (`VAR=x cmd`); scripted-model
tests are plumbing tests only; reproduce a suspected bug with a test before fixing; no assistant attribution on git commits.
Still open from earlier phases: labelled retrieval benchmark (Phase 6), Tauri sidecar measurement and 1B.4, Qwen research-license replacement before
any commercial release (D-049).
