# Context: Coding Harness

> Read this file first. Then read `AGENTS.md` (the authoritative rules for any agent). Current execution state lives in `docs/status.md`; design history lives in `docs/decisions.md`.

## Project

A TypeScript multi-agent coding harness built on Cordis. Bundles provide model access, tools, retrieval, memory, sandbox providers, routing, policy gates and evaluation. Profiles compose them. The repository is `yash936936/Harness`; default branch is `main`.

## Where things live

| Need | File |
|---|---|
| Rules for any agent (entry protocol, evidence classes, debugging, repeated-failure rule, logging duties) | `AGENTS.md` |
| Paste-in prompt that points an agent at the rules | `prompt.md` |
| What each component is, its files, exports, route, config, limits | `docs/components/<area>.md` (index: `docs/components/README.md`) |
| Every command, review and outcome, machine-readable, append-only | `docs/logs/events.jsonl` |
| Recurring failures ranked by occurrences, with HOLD status (generated) | `docs/FAILURE-LEDGER.md` |
| Design decisions (append-only) | `docs/decisions.md` |
| Findings per task (append-only) | `docs/debug.md` |
| Current state and next steps | `docs/status.md` |
| Merge gate settings | `docs/BRANCH-PROTECTION.md` |
| Per-responsibility file split plan | `docs/REFACTOR-PLAN.md` |

`docs/components/*.md` hold hand-written Purpose / Route / Config / Known limits plus a generated files-and-exports table. `docs/FAILURE-LEDGER.md` is generated from the event log; never edit either generated part by hand.

## Current state (2026-11-13, D-117)

Read docs/STATE.md for the authoritative state table. D-117 authorizes full development command execution only inside a remote cloud sandbox and cloud-hosted model testing. There is no host execution or local fallback. D-110 remains in force for Docker/WSL/Crabbox; S0 stays PERMANENT-HOLD and S1 stays deferred. S4 is reopened only as a cloud-only acceptance plan and is not passed. The existing sandbox service enforces remote consent and host allowlisting, and the command tool already uses that seam, but the CLI still filters COMMAND_TOOL and no cloud sandbox provider is integrated or verified. Cloud model and cloud sandbox egress are separate consent destinations. Current Ollama provider code does not establish cloud API-key authentication. D-116 D3 and D-109 evaluation requirements remain unchanged. See docs/architecture.md, docs/ROADMAP.md, docs/BUILD-PLAN.md and docs/STATE.md.

## Required reading order

1. `AGENTS.md`
2. `docs/status.md` (newest status entry)
3. `docs/FAILURE-LEDGER.md`
4. `docs/decisions.md` (relevant D-IDs)
5. `docs/components/<area>.md` for areas you will touch
6. `docs/phases.md` for acceptance criteria; `docs/debug.md` for history

## Workflow rules (summary; full text in AGENTS.md)

- Keep policy gates fail-closed. Never weaken checks to make a test pass.
- No Docker, WSL or Crabbox probes (D-110). D-117 permits `run_command` only through an explicitly selected remote cloud sandbox; no host or local fallback.
- `router.owned` stays empty for any class without measured Needle-vs-worker evidence.
- Semantic memory is untrusted input: bounded, source-attributed, actor-scoped, fenced by input-guard.
- Never synthesize labels, results, usage or measurements.
- Three identical failures = stop and decide (change the part wholesale, or hold it), logged as a decision.
- Log commands through `scripts/events/run-logged.mjs`; findings in `docs/debug.md`; decisions in `docs/decisions.md`; state in `docs/status.md`.
- One source file per responsibility; keep `docs/components/` in sync with `npm run docs:components`.

## End-of-run

Append technical findings to `docs/debug.md`, design decisions to `docs/decisions.md`, and update `docs/status.md`. Update the public-facing `docs/readme.md` only to describe capabilities actually verified.

---
**Next:** Return to [`AGENTS.md`](./AGENTS.md).
