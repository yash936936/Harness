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

## Current state (2026-11-13)

Read `docs/STATE.md` for the authoritative state table and the newest entry in `docs/status.md` for history. D-116 has been approved: D1 no command execution; D2 one restricted stronger free OpenRouter comparison session while 3B remains the local/headline model; D3 three qualitative demo sessions only, with no scorer output until D-109's 10 genuine labelled sessions and label-before-scorer requirements are met. R1 is closed. R2 remains partial (S7 live rerun and session-scoped approval work remain); R3 has not started and its three session JSONLs, owner-reviewed summary, measured cold-start time, quickstart, and demo script are outstanding. S6/S7 remain open. PR #87 is merged at `e8614f12e1a66cbea9adfe230a902e1c72f4b9d4`; PR #88 documentation follow-up is not yet confirmed merged. Main branch protection remains disabled. D-110 continues to prohibit command execution and Docker/WSL/Crabbox probing.

## Required reading order

1. `AGENTS.md`
2. `docs/status.md` (newest status entry)
3. `docs/FAILURE-LEDGER.md`
4. `docs/decisions.md` (relevant D-IDs)
5. `docs/components/<area>.md` for areas you will touch
6. `docs/phases.md` for acceptance criteria; `docs/debug.md` for history

## Workflow rules (summary; full text in AGENTS.md)

- Keep policy gates fail-closed. Never weaken checks to make a test pass.
- No Docker, WSL or Crabbox probes or host-command fallback (D-110). `run_command` is only offered with a healthy sandbox.
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
