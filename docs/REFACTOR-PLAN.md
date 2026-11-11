# Refactor plan: one file per responsibility

Rule (AGENTS.md section 4): one source file per responsibility, not per function. Behaviour-preserving, one area per PR, tests green before and after, no feature work mixed in.

## Status: COMPLETE

Step 0 and all justified extractions are complete. The retrieval-rank file-access, memory episodic, skills matcher, tools-local sandbox command factory, orchestrator prompt formatter, CLI Docker detector, profile-coding policy self-test, and agent-loop response guard changes are merged (PRs #66, #67, #71, #72, #73, #74, #75, and #77; see DBG-109 and DBG-111 through DBG-117). The tool registry was measured at 230 lines with 4 exports and deliberately kept as one enforcement choke point; its component documentation is merged in PR #79 (DBG-118). The model-adapter service was reviewed and kept intact because provider adapters, budget gate, and rate limiter already have separate modules and the remaining model-call lifecycle is cohesive. All candidate areas named in this plan were measured and reviewed; no candidate remains queued.

The initial plan was written without a checkout of `src/`. Step 0 measurements and each subsequent re-measurement are recorded in `docs/debug.md` (DBG-109 through DBG-119).

## Step 0: measure (no code change)

For each area, count lines and exported symbols per file and list files that mix concerns. Previously identified candidates, now measured in DBG-109: `tools-local/index.ts`, `policy-gates/index.ts`, `orchestrator/execute.ts`, `retrieval-rank/index.ts`, `memory/index.ts`, `model-adapter/index.ts`, and `src/cli/code.ts`. The initial candidate table is in `docs/debug.md`; re-measure after each merge before choosing the next split. After PR #72, `tools-local/index.ts` is 406 lines with 6 exported declarations and `tools-local/command.ts` is 75 lines with 2 exported declarations. After the PR #73 extraction, `orchestrator/execute.ts` is 255 lines with 3 exported declarations and `orchestrator/prompt.ts` is 33 lines with 1 exported declaration. The CLI candidate was 215 lines with 6 exported declarations; after extraction, `src/cli/code.ts` is 209 lines with 5 exported declarations and `src/cli/docker.ts` is 13 lines with 1 exported declaration. `src/profiles/profile-coding.ts` was 268 lines with 8 exported declarations; after extraction it is 224 lines with 6 exported declarations, while `src/profiles/verify-gates.ts` is 55 lines with 2 exported declarations. `profile-minimal.ts` is 75 lines with 4 exports and remains a cohesive small composition profile. `agent-loop/index.ts` was 329 lines with 3 exported declarations; after the current extraction it is 312 lines with 3 exported declarations and `agent-loop/response-guards.ts` is 24 lines with 2 internal exports. `tool-registry/index.ts` remains 230 lines with 4 exports and 84-line `types.ts` with 11 exports; it remains one single choke-point service. `model-adapter/index.ts` remains 228 lines with 4 exports; provider implementations, `budget-gate.ts`, and `rate-limiter.ts` are already separated, so the remaining service lifecycle stays cohesive.

## Validation record

All implementation PRs passed the full GitHub Actions workflow on Ubuntu and Windows. Final main validation: run #508 passed 55 test files, 2 skipped; 1,133 tests passed, 102 skipped (1,235 total), plus typecheck, lint, documentation/component drift, secret/dependency checks, license inventory, and aggregate `ci-pass`. Earlier PR runs #493, #495, #496, #497, and #505 also passed their full platform matrix. No local npm commands were run during the GitHub connector edits. CI is the recorded test evidence; it is not live-model, sandbox, or S0 acceptance evidence.

## Per-area procedure

1. Run `npm run check` and record the test count. Open `docs/components/<area>.md`.
2. Move one responsibility into its own file with a header comment. Keep the public export surface unchanged (re-export from `index.ts`).
3. Run the area's tests, then typecheck and lint. Repeat per responsibility.
4. `npm run docs:components`, fill the area's Purpose / Route / Config / Known limits.
5. Full suite on Ubuntu and Windows via CI. Test count must be unchanged or higher.
6. Log the PR through `log-event.mjs`. If the same failure recurs 3 times, AGENTS.md section 6 applies: stop that area.

## Order (lowest risk first)

Pure-logic areas first (`egress`, `input-guard`, `policy-gates/denylist`, `retrieval-rank/text`), then services (`memory`, `skills`, `orchestrator`), then the CLI and profiles, last the tool registry and agent loop, which everything depends on.

## Do not

Split a Cordis service class across files by method. Rename exports. Change behaviour. Touch an area that is on HOLD in the failure ledger.

---
**Next:** Return to [`context.md`](../context.md).
