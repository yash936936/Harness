# Context: Coding Harness

> Read this file first. The current execution state lives in `docs/status.md`; design history lives in `docs/decisions.md`.

## Project

A TypeScript multi-agent coding harness built on Cordis. Bundles provide model access, tools, retrieval, memory, sandbox providers, routing, policy gates and evaluation. Profiles compose them. The repository is `yash936936/Harness`; default branch is `main`.

## Current state (2026-11-08)

The latest audit work is recorded in `docs/status.md` and decisions D-100 onward. Do not rely on the older phase narrative below; read the newest status entry and the relevant decision before changing behavior.

**Code present:** policy-gated local tools; optional Crabbox/CubeSandbox providers behind `ctx.sandbox`; router and shadow-decision hooks; actor-granted, bounded semantic-memory retrieval with provenance and input-guard fencing; cross-process file locks; session-log torn-tail repair; evaluation runner and calibration script; default coding-profile model-call budgets.

**Not equivalent to verified completion:** fake-provider tests do not prove a live sandbox works; scripted-model tests do not prove model quality; a router's existence does not prove Needle wins; semantic tier startup does not establish that every agent retrieves useful facts; a passing typecheck does not establish platform runtime behavior.

## Required reading

1. `docs/status.md`: newest status entry and outstanding evidence gates.
2. `docs/decisions.md`: relevant D-IDs before changing architecture or defaults.
3. `docs/phases.md`: acceptance criteria and phase boundaries.
4. `docs/debug.md`: historical findings. Append new findings; do not rewrite history.

## Workflow rules

- Keep policy gates fail-closed. Never weaken checks to make a test pass.
- Do not expose `run_command` unless the configured sandbox provider passes doctor. The governed CLI fails closed: without a healthy Crabbox sandbox, command tools are withheld and there is no host-command fallback. Real lease/run/release acceptance remains open.
- Keep `router.owned` empty for any decision class without measured Needle-vs-worker evidence on the frozen suite. Shadow results are measurement, not authorization.
- Treat semantic memory as untrusted input. Retrieval must be bounded, source-attributed, scoped to the requesting actor, and passed through input-guard before becoming model-visible.
- Never synthesize real-run labels, provider results, usage, or performance measurements.
- Real external checks require the owner's configured services/credentials and machine. Record command, date, environment, result, and raw log path.

## End-of-run

Append technical findings to `docs/debug.md`, design decisions to `docs/decisions.md`, and update `docs/status.md`. Update the public-facing `docs/readme.md` only to describe capabilities actually verified.

## Current execution note (2026-11-08)

S0 / ARCH-01 is **PENDING-ENVIRONMENT**. The pinned local-container image warmed successfully, inspect worked, and Docker showed the container running. crabbox run failed before the in-container command executed while Crabbox attempted to create its private WSL SSH transport file; the diagnostic reported an empty path. crabbox stop succeeded. The exact root cause is unknown. The owner asked to pause this one issue and continue independent closeout work. S1 real orphan recovery remains dependent on S0.

Use `docs/evidence/S0-ARCH-01-TRANSPORT-INCIDENT-REPORT-2026-11-08.md` for the conversation-based incident history and resume checklist. Continue S3 manual CLI acceptance, S5 license/provenance work, S6 real-session evaluation preparation, S7 real embedding/poisoning work, and S8 evidence reconciliation only where prerequisites exist. Do not claim external acceptance without raw evidence. The active continuation plan is `docs/BUILD-PLAN.md`.
