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

## Current state (2026-11-11)

Read the newest entry in `docs/status.md`; do not rely on this summary. The current deliverable is a sample/research prototype with no distributable artifact planned (D-115); the repository's public visibility is unchanged. S0 is on permanent hold (D-110), S1 deferred, S3 closed for file-tool/policy acceptance, S4 blocked (D-112), S5 / ENG-04 release work deferred/out of scope (not passed), S6 requires genuine owner-labelled sessions under D-109, and S7 requires focused live embedding and 3B poison-resistance checks. PR #83's refusal fix is merged and passed cross-platform CI. The next live rerun found an ungrounded synthesis hallucination; branch fix/explicit-read-synthesis-dependencies-2026-11-12 adds dependency and evidence-grounding corrections. S7 remains PARTIAL pending CI and another owner-run rerun. Only `qwen2.5-coder:3b-instruct` is in scope (D-114).

**Code present is not acceptance.** Fake-provider tests do not prove a live sandbox works; scripted-model tests do not prove model quality; a green CI does not close any external gate. See the evidence classes in `AGENTS.md`.

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
