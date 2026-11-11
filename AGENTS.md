# AGENTS.md — instructions for any agent working in this repo

This is the single authoritative instruction file. `context.md` routes here; `prompt.md` is a paste-in wrapper around it. If another file contradicts this one, this one wins, unless a newer entry in `docs/decisions.md` says otherwise.

## 1. Entry protocol (every session, in order)

1. Read `context.md`.
2. Read the newest entry in `docs/status.md`. Do not rely on memory of earlier chats.
3. Read `docs/FAILURE-LEDGER.md`. If anything there is `HOLD`, do not touch that area until you have read section 6.
4. Check `docs/decisions.md` (newest first) before proposing anything that might contradict a logged decision. Do not reopen a decision unless the owner does. Current hard ones: D-110 (S0 permanent hold), D-114 (only `qwen2.5-coder:3b-instruct`).
5. Read `docs/components/<area>.md` for every area you are about to change.
6. Check the working tree: `git status`, then `npm run typecheck` and `npm test` (separate commands).

## 2. Evidence classes: never blur them

| Class | Meaning | Does NOT prove |
|---|---|---|
| Code present | It exists in the tree | That it runs or is correct |
| CI green | Typecheck, lint, tests passed on Ubuntu and Windows | Real Docker/Crabbox, live providers, real model behaviour, human labels |
| Scripted-model test | Plumbing works with a stand-in model | That a real model behaves well |
| External acceptance | Owner-run, raw output and session JSONL preserved | (This is the only class that closes an acceptance gate) |

A green `npm test` is never acceptance. Never fabricate labels, sessions, provider results, usage, or measurements. Record unknowns as unknown.

## 3. Hard prohibitions

- No Docker, WSL or Crabbox probes, retries, workarounds, or host-execution fallback (D-110) unless the owner explicitly supersedes it in a new decision.
- Model scope: only `qwen2.5-coder:3b-instruct` for acceptance (D-114).
- Never weaken a policy gate, threshold, deny rule or consent check to make a test pass. Fix the cause.
- No secrets in command arguments, files, logs or chat. Environment variables only. Logged commands are redacted, but do not rely on that.
- Do not add a model-specific workaround (alias mapping, value coercion, prompt tuning for one model's mistakes) without: (a) a decision entry saying why, (b) a general test that does not depend on that model, (c) a note in the component doc. The harness must not be tuned to pass one acceptance script.
- Do not edit generated files by hand: `docs/FAILURE-LEDGER.md`, the `GENERATED` block in `docs/components/*.md`.
- No Claude/assistant attribution on git commits.

## 4. Code structure rule

One source file per responsibility: one exported class, or one cohesive set of pure functions. Not one file per function (Cordis services are classes; splitting methods across files hurts readability). Split a file when it mixes concerns or its tests need to stub unrelated parts. Every source file starts with a header comment whose first line states its responsibility. Every area (bundle, `cli`, `profiles`, `util`) has `docs/components/<area>.md` with Purpose, Route, Config/invariants and Known limits written by hand, plus a generated files/exports table. After changing `src/`, run `npm run docs:components` and fill any `(open — ...)` section you touched.

Refactors: one area per PR, behaviour-preserving, tests green before and after, no mixing with feature work. See `docs/REFACTOR-PLAN.md`.

## 5. Debugging procedure

1. **Reproduce** with the smallest command. Run it through the logger: `node scripts/events/run-logged.mjs --area <ID> -- <command>` (add `--shell` for `npm` on Windows). Keep the raw output.
2. **Locate the layer** before changing anything: input, config, environment, our code, a dependency, the platform. State a hypothesis and the observation that would disprove it.
3. **Change one thing**, rerun the same command, log the result.
4. **Prove the fix fails on the old code**: add a regression test, run it against the unfixed source, confirm it fails, then confirm it passes. A test that cannot fail is not evidence.
5. **Run the narrowest tests first** (the affected file, then typecheck), the full suite once at the end.
6. **Record**: `docs/debug.md` (DBG-NNN) for findings, `docs/decisions.md` (D-NNN) for choices, `docs/status.md` for state. Say what was NOT tested.

Environment notes: PowerShell 5.1 has no `&&`; give commands on separate lines. In Git Bash, PATH entries must be Unix-style. `npm`/`npx` need `--shell` with the logger on Windows. A large paste does not fit a terminal; capture to a file and show the tail.

## 6. Repeated failure rule

Every failure has a signature (normalised error line). `docs/FAILURE-LEDGER.md` ranks signatures by occurrences since their last logged resolution.

- **2 occurrences (`watch`)**: stop and state a new hypothesis before trying again. Do not rerun the same command hoping.
- **3 occurrences (`HOLD`)**: stop working on that part. Write up in `docs/debug.md`: what was tried, what each attempt showed, what is still unknown. Then choose exactly one and log it as a decision (D-NNN):
  1. **Change the part wholesale** (different approach, not another patch), or
  2. **Put it on hold** and record what is blocked and what would reopen it.
  Then log a resolution event: `node scripts/events/log-event.mjs --kind resolution --area <ID> --signature "<sig>" --summary "<what and D-NNN>"`. A summary containing "hold" is shown as `on-hold`.
- Never delete or edit events. The log is append-only.
- The same class of failure recurring under different signatures counts too (example: test expectations going stale after an intentional behaviour change, already seen twice). When you change behaviour, grep tests for the old expectation first.

## 7. Logging duties (not optional)

| What happened | Where it goes |
|---|---|
| Any command run during real work | Event log, via `run-logged.mjs` |
| A review, inspection, owner-supplied evidence | `node scripts/events/log-event.mjs --kind review --area <ID> --outcome success|failure --summary "…"` |
| A completed coding task, including "no issues found" | `docs/debug.md` (append, newest first) |
| A design or scope choice | `docs/decisions.md` (new D-NNN, never edit old ones) |
| End of session | `docs/status.md` newest entry |
| Phase or sub-phase completed | `docs/phases.md`, and `docs/readme.md` to real capabilities only |

`docs/logs/events.jsonl` is machine-readable and append-only; humans read `docs/FAILURE-LEDGER.md`.

## 8. CI and merging

- Required status check: `ci-pass` (aggregates all jobs). See `docs/BRANCH-PROTECTION.md`.
- Do not merge red. If a merged PR turns main red, fixing main is the next task and is logged as a failure event.
- CI cannot cover real sandbox, live providers or human-labelled evaluation. The CI summary lists them as NOT RUN; do not read green as acceptance.
- Before opening a PR: `npm run check`, `npm run docs:components`, `npm run docs:check`.

## 9. Handoff

End every working session with: what changed, what was verified and how, what was not verified, the next command for the owner (if an external gate needs them), and which docs were updated.
