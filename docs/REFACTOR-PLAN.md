# Refactor plan: one file per responsibility

Rule (AGENTS.md section 4): one source file per responsibility, not per function. Behaviour-preserving, one area per PR, tests green before and after, no feature work mixed in.

## Status: IN PROGRESS

Step 0 has been performed for the documented high-risk candidates and the low-risk files listed below. The retrieval-rank file-access, memory episodic, skills matcher, and tools-local sandbox command factory extractions are merged (PRs #66, #67, #71, and #72; see DBG-109, DBG-111, DBG-112, and DBG-113). The current measured area is the orchestrator subtask-prompt formatter extraction (see DBG-114). Remaining candidates stay queued until their own area is measured and component docs are reviewed.

The initial plan was written without a checkout of `src/`. Step 0 measurements for the first candidate set are now recorded in `docs/debug.md` (DBG-109); measure each remaining area before splitting it.

## Step 0: measure (no code change)

For each area, count lines and exported symbols per file and list files that mix concerns. Previously identified candidates, now measured in DBG-109: `tools-local/index.ts`, `policy-gates/index.ts`, `orchestrator/execute.ts`, `retrieval-rank/index.ts`, `memory/index.ts`, `model-adapter/index.ts`, and `src/cli/code.ts`. The initial candidate table is in `docs/debug.md`; re-measure after each merge before choosing the next split. After PR #72, `tools-local/index.ts` is 406 lines with 6 exported declarations and `tools-local/command.ts` is 75 lines with 2 exported declarations. After the current extraction, `orchestrator/execute.ts` is 255 lines with 3 exported declarations and `orchestrator/prompt.ts` is 33 lines with 1 exported declaration.

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
