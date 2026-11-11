# Refactor plan: one file per responsibility

Rule (AGENTS.md section 4): one source file per responsibility, not per function. Behaviour-preserving, one area per PR, tests green before and after, no feature work mixed in.

## Status: IN PROGRESS

Step 0 has been performed for the documented high-risk candidates and the low-risk files listed below. The first justified extraction is the retrieval-rank file-access responsibility; see DBG-109. Remaining candidates stay queued until their own area is measured and the component docs are reviewed.

This plan was written without a checkout of `src/`. Step 0 must measure before any file is split.

## Step 0: measure (no code change)

For each area, count lines and exported symbols per file and list files that mix concerns. Candidates from the docs, unverified: `tools-local/index.ts`, `policy-gates/index.ts`, `orchestrator/execute.ts`, `retrieval-rank/index.ts`, `memory/index.ts`, `model-adapter/index.ts`, `src/cli/code.ts`. Record the table in `docs/debug.md`. Split only what the measurement justifies.

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
