# Refactor plan: one file per responsibility

Rule (AGENTS.md section 4): one source file per responsibility, not per function. Behaviour-preserving, one area per PR, tests green before and after, no feature work mixed in.

## Status: IN PROGRESS

Step 0 has been performed for the documented high-risk candidates and the low-risk files listed below. The retrieval-rank file-access, memory episodic, skills matcher, and tools-local sandbox command factory extractions are merged (PRs #66, #67, #71, and #72; see DBG-109, DBG-111, DBG-112, and DBG-113). The orchestrator subtask-prompt formatter extraction is in PR #73 with full CI green (see DBG-114). CLI Docker capability detection is in PR #74 with full CI green (see DBG-115). The profile-coding boot-time policy self-test is in PR #75 with full CI green (see DBG-116). The current measured area is the agent-loop response finalization guards (see DBG-117). The tool registry was re-measured at 230 lines with 4 exports; registration, schema validation, policy hooks, execution, post-execution scanning, and audit logging form one inseparable choke point, so no class or helper split is justified there. The model-adapter service was re-reviewed and does not justify another split: provider adapters, budget gate, and rate limiter already have separate modules, while the remaining service method is one cohesive model-call lifecycle. Remaining candidates stay queued until their own area is measured and component docs are reviewed.

The initial plan was written without a checkout of `src/`. Step 0 measurements for the first candidate set are now recorded in `docs/debug.md` (DBG-109); measure each remaining area before splitting it.

## Step 0: measure (no code change)

For each area, count lines and exported symbols per file and list files that mix concerns. Previously identified candidates, now measured in DBG-109: `tools-local/index.ts`, `policy-gates/index.ts`, `orchestrator/execute.ts`, `retrieval-rank/index.ts`, `memory/index.ts`, `model-adapter/index.ts`, and `src/cli/code.ts`. The initial candidate table is in `docs/debug.md`; re-measure after each merge before choosing the next split. After PR #72, `tools-local/index.ts` is 406 lines with 6 exported declarations and `tools-local/command.ts` is 75 lines with 2 exported declarations. After the PR #73 extraction, `orchestrator/execute.ts` is 255 lines with 3 exported declarations and `orchestrator/prompt.ts` is 33 lines with 1 exported declaration. The CLI candidate was 215 lines with 6 exported declarations; after extraction, `src/cli/code.ts` is 209 lines with 5 exported declarations and `src/cli/docker.ts` is 13 lines with 1 exported declaration. `src/profiles/profile-coding.ts` was 268 lines with 8 exported declarations; after extraction it is 224 lines with 6 exported declarations, while `src/profiles/verify-gates.ts` is 55 lines with 2 exported declarations. `profile-minimal.ts` is 75 lines with 4 exports and remains a cohesive small composition profile. `agent-loop/index.ts` was 329 lines with 3 exported declarations; after the current extraction it is 312 lines with 3 exported declarations and `agent-loop/response-guards.ts` is 24 lines with 2 internal exports. `tool-registry/index.ts` remains 230 lines with 4 exports and 84-line `types.ts` with 11 exports; it remains one single choke-point service. `model-adapter/index.ts` remains 228 lines with 4 exports; provider implementations, `budget-gate.ts`, and `rate-limiter.ts` are already separated, so the remaining service lifecycle stays cohesive.

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
