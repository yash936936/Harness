# OpenRouter live-run evidence

**Status: smoke PASS; full S4 acceptance BLOCKED-S0-PERMANENT-HOLD.**

## Smoke evidence (owner supplied, 2026-11-10)

The owner ran `npm run smoke:openrouter` after installing dependencies. Output:
- Model: `cohere/north-mini-code:free`
- `ok: true`
- `stopReason: end_turn`
- Usage: 11 input tokens, 57 output tokens
- Text: `HARNESS_OPENROUTER_OK`

PR #41 merged as `778ab63fb69f3ebf9cc916643b50f4ae0f214ff8`; GitHub Actions run #403 passed on Windows and Ubuntu. This validates the smoke request only. It does not establish full governed coding-task acceptance.

## Remaining full-task gate

The full S4 task requires a governed code change, preserved session log, evidence that the API key is absent from stdout/session logs/committed files, and successful target-project tests. No full OpenRouter coding task has been run or accepted.

Under D-110, no Docker/WSL/Crabbox probes, retries, workarounds, or host-execution substitutes are permitted. In `src/cli/code.ts`, `run_command` is offered only after Docker detection and successful Crabbox doctor. With `--sandbox none`, command execution is omitted and no host fallback exists. Therefore the target-project test portion of S4 cannot be completed under the current permanent S0 hold. Do not attempt `--sandbox auto` or a host command fallback.

Reopen this gate only after an explicit owner decision supersedes D-110 and authorizes a supported execution environment.

## Secret handling

Set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` only in the local environment. Never place the key in command arguments, source files, session logs, or pasted transcripts. Any future full-task evidence must use a seeded-secret scan that reports only pass/fail and never prints the key.

