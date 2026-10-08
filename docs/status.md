# Status — Coding Harness

> Updated every run. Newest entry at top.

## 2026-10-08 (evening) — item 5 prepared: real-model run on `profile-coding` (D-084)
Windows run of D-083: 861 passed / 7 skipped, 42 files, pushed as 60d4b5d. `scripts/smoke-coding.ts` is ready (self-tested with a stand-in and a do-nothing negative control; not yet run against a model). Models chosen by me: llama3.2:3b and qwen2.5-coder:3b-instruct.
**Owner to run (Git Bash), then paste the whole output:** `HARNESS_CODING_MODELS=llama3.2:3b,qwen2.5-coder:3b-instruct HARNESS_TRIALS=3 npx tsx scripts/smoke-coding.ts` (needs Ollama serving; takes a while on CPU).
**Next:** record the numbers (D-085), fix what they show (invalid `edit_file` input, no `confidence`, wrong results), then items 6 and 7 from the same run, then 4.5 router, 5.1, 5.2, Phase 6.

## 2026-10-08 (later) — open items 2, 3, 4 closed in code (D-083, DBG-054)
Done: stale known-gaps line corrected (`profile-coding` wires memory, subagents, skills-when-named); `input-guard` fences and flags every tool result (heuristic, not prevention); lessons are now derived by template from harness facts and promoted through existing compaction. Linux 770 passed / 98 skipped.
**Owner to run (Git Bash):** extract the new zip over the repo, `npm install`, `npm run typecheck`, `npm test` (expect 861 passed / 7 skipped, 42 files), commit, push.
**Open-item register now:** 1 done (D-082) | 2 done | 3 done in code, real-model respect unmeasured | 4 done | 5 first real-model run on `profile-coding` (NEXT, needs the owner's Ollama) | 6 which model plans | 7 never measured: real failures (D-074), answer correctness, hot-rule following | 8 benchmark stays in Phase 6 (agreed) | 9 Tauri/1B.4 | 10 Qwen license (D-049). Then 4.5 router, 5.1, 5.2, Phase 6.

## 2026-10-08 — Windows-verified 5.6 and real tools; one bug found and fixed (D-082, DBG-053)
Owner run: 814 passed / 7 skipped, commit 7719e84 pushed. `run_command` works on Windows for `node`, `git` and `npm` (my "npm will fail" prediction was wrong). `npm.cmd` exposed a real bug in `ctx.subprocess` (use before declaration on a synchronous spawn failure); fixed with a regression test. Linux: typecheck clean, subprocess tests 19/19.
**Owner to run (Git Bash):** extract the new zip over the repo, `npm install`, `npm run typecheck`, `npm test` (expect 815 passed / 7 skipped, 40 files), commit, push.
**Plan set by owner:** close ALL remaining open items, then Phase 4 router (4.5, Needle), then 5.1 (sandbox), then Phase 6. Open-item register below in this entry's next step (see the reply that produced it); to be copied here once the owner confirms the order.

## 2026-10-07 (later) — 5.6 built: `profile-coding` + guardrail integration test (D-081, DBG-052)
`bootProfileCoding` boots the full coding stack (scope before gate; real tools; `commandRisk` always wired; threshold floor 0.5) and **refuses to boot with the gates off, or if `verifyGates` cannot prove they enforce** (a probe `rm -rf /` must be blocked, a shell command held). One scripted run hits all five classes and an independent log audit finds nothing. 38 tests, Linux 723 passed / 98 skipped.
**Owner to run (Git Bash):** extract the new zip over the repo, `npm install`, `npm run typecheck`, `npm test` (expect 814 passed / 7 skipped, 40 files), commit and push. Also still wanted from the last step: output of `run_command` with `node --version`, `git status`, `npm test` on Windows.
**Decision for you:** the 0.5 floor on `confidenceThreshold` is my choice (D-081).
**Phase 5 is NOT fully closed:** 5.1/5.2 (real sandboxes) are unbuilt, so no real tool is sandbox-write or external-side-effect yet.
**Next up:** a first real-model run on `profile-coding` (does a 3B model produce a valid `edit_file`, and a `confidence`?); then decide between 5.1 (sandbox), the Phase 4 router, or Phase 6 (evals).

## 2026-10-07 — real tools built (D-080, DBG-051)
`bundle-tools-local`: `read_file`, `edit_file`, `write_file`, `run_command` over the real filesystem and `ctx.subprocess`, registered real-fs-write (read_file read-only). The gates now guard real tools. 40 tests, 15 mutations (14 caught, 1 equivalent). Linux 685 passed / 98 skipped.
**Owner to run (Git Bash):** extract the new zip over the repo, `npm install`, `npm run typecheck`, `npm test` (expect 776 passed / 7 skipped, 39 files; a few more skipped if symlinks cannot be created), then commit and push.
**Found:** a command call would have scored 1.0 on the path and size signals and auto-run at confidence 0.9. Fixed by design (no path-like fields, so no signal means HOLD) plus the `commandRisk` signal, which the profile MUST pass to the gate.
**Likely problem on Windows (unverified):** `run_command {command:'npm'}` probably cannot start (`.cmd` with no shell). Please try `node --version` and `git status` (should work) and `npm test` (probably fails) and paste the output.
**Next up:** 5.6 with `profile-coding` (wires tools-local, policy-gates with `commandRisk`, subagent-scope ordering; refuses to boot with the gates off). Then a first real-model run with these tools (does a 3B model produce a valid `edit_file`, and any `confidence`?).

## 2026-10-06 (later) — Phase 5.3-5.5 policy gates built (D-079, DBG-050); two more real runs recorded (D-078)
`ctx.policy`: deny-list, external-side-effect always held, confidence-scored real-fs-write with approvals, sandbox/read-only logged. 44 tests, 24 mutations caught. Linux 645 passed / 98 skipped.
**Owner to run (Git Bash):** extract `Harness-phase5.zip`, `npm install`, `npm run typecheck`, `npm test` (expect 736 passed / 7 skipped, 38 files), then commit and push.
**Found:** the repo registers only read-only tools, so the gate currently guards tools that do not exist yet. The deny-list does not catch encoded or indirect commands.
**Next up:** 5.6 integration test (all five classes in one run; `profile-coding` must refuse to boot with the gates off). That needs a `profile-coding` file, which does not exist yet.
Beyond 5.6, the real gap is that there are no actual write or shell tools: building a file-edit tool and a shell tool (over `ctx.subprocess`), registered with the right classes, would make the gates guard something real. 5.1 (crabbox) is amended and needs measurements first; 5.2 is deferred to Phase 8.

## 2026-10-06 — phases 4.1-4.4 closed; real-model results in (D-077, DBG-049)
Windows 690 passed / 7 skipped (37 files). Planner n=15: constrained 29/30 first-try valid vs 20/30 unconstrained (p=0.006 pooled); 30/30 vs 28/30 after repair. First real executor run: 11 of 12 plans executed to completion, 0 failed subtasks of 30.
Not shown: answer correctness, plan quality, any real failure through the D-074 policy, qwen as a worker. Added array-size limits to the plan schema (unverified on the owner's Ollama).
**Owner to do:** extract `Harness-phase4.5prep.zip`, `npm install`, `npm run typecheck`, `npm test` (expect 692 passed / 7 skipped, 37 files); then COMMIT 4.4 and this (4.4's test and docs were not in commit 8492894).
Optional measurements, each cheap: (a) `HARNESS_TRIALS=5 HARNESS_OLLAMA_CHAT_MODEL=llama3.2:3b,qwen2.5-coder:3b-instruct npx tsx scripts/smoke-plan.ts` to confirm the size limits do not break the schema on this Ollama; (b) the split config (qwen plans, llama works).
**Next up:** Phase 5 (policy gates) is my recommendation; planners already request write tools, and a `real-fs-write` grant is held back only by the ceiling. 4.5 (router) stays optional and has its own prerequisites.

## 2026-10-05 (end) — 4.4 end-to-end test done (D-076, DBG-048)
11 tests, no `src/` change. Linux 599 passed / 98 skipped. **Owner to run (Git Bash):** `npm install`, `npm run typecheck`, `npm test` (expect 690 passed / 7 skipped, 37 files).
Phases 4.1-4.4 are done against scripted models. Still owed by the owner, and needed to call 4.1/4.2 measured rather than just built: the `scripts/smoke-plan.ts` comparison (D-072) and a first `scripts/smoke-execute.ts` run (D-075).
**Next up:** 4.5 router (Needle), which is optional and has its own prerequisites (pinned model in the model store 1B.3, a frozen router suite). Or Phase 5 (policy gates), which is what actually makes a `real-fs-write` grant safe.
Open: whether to do 4.5 before Phase 5.

## 2026-10-05 (night) — 4.2 executor built (D-075, DBG-047)
Executor implements the D-074 policy; 25 tests, 22 mutations caught; Linux 588 passed / 98 skipped.
**Owner to run (Git Bash):** `npm install`, `npm run typecheck`, `npm test` (expect 679 passed / 7 skipped, 36 files). Then, with Ollama serving, the first real end-to-end run:
`HARNESS_TRIALS=3 HARNESS_OLLAMA_CHAT_MODEL=llama3.2:3b npx tsx scripts/smoke-execute.ts` (planner and worker are the same model; split them with HARNESS_PLANNER_MODEL / HARNESS_WORKER_MODEL). Paste it whole.
Still pending from before: the constrained-vs-unconstrained `scripts/smoke-plan.ts` comparison (D-072). It decides which model PLANS; it does not block 4.4.
**Next up:** 4.4 end-to-end test (scripted, a plan across at least two scoped sub-agents, each confined to its own scope, all visible in the log), then 4.5 router if wanted.

## 2026-10-05 (later) — 4.3b memory scoping built (D-073); executor failure policy decided (D-074)
Memory is scoped per sub-agent (access grants, scoped hot rules, per-agent episodes, per-agent compaction); a real cross-agent compaction leak was found and closed.
Linux 563 passed / 98 skipped. **Owner to run (Git Bash):** `npm install`, `npm run typecheck`, `npm test` (expect 654 passed / 7 skipped, 35 files).
**Still waiting on the owner:** the constrained-vs-unconstrained `scripts/smoke-plan.ts` comparison (see the entry below). 4.2 depends on it; nothing else does.
**Next up:** 4.2 executor with the D-074 policy, once the comparison is in. Then 4.4.

## 2026-10-05 — planner reality check; structured output added (D-072, DBG-045)
smoke-plan unconstrained: llama 6/9 valid, qwen 7/9 (n=9, cannot rank). Constrained decoding built and unit-tested; effect on real models UNMEASURED.
**Owner to run (Git Bash):** `npm install`, `npm run typecheck`, `npm test` (expect 633 passed / 7 skipped, 34 files), then BOTH:
`HARNESS_TRIALS=5 HARNESS_STRUCTURED=0 HARNESS_OLLAMA_CHAT_MODEL=llama3.2:3b,qwen2.5-coder:3b-instruct npx tsx scripts/smoke-plan.ts` (baseline, n=15) and the same
without `HARNESS_STRUCTURED=0`. Paste both whole.
**Next up:** 4.2 executor only after that comparison. If structured output lifts validity near 100% the executor can assume plans; if not, the planner needs a stronger model.
Open: memory scoping (blocks 4.3's last criterion and 4.4); executor failure policy (lean: abort by default).

## 2026-10-04 (night) — 4.1 planner built (D-071, DBG-044)
4.3 verified on Windows (614 passed / 7 skipped). 4.1: `ctx.orchestrator.plan()`; 13 tests, 14 mutations caught; Linux 536 passed / 98 skipped.
**Owner to run (Git Bash):** `npm install`, `npm run typecheck`, `npm test` (expect 627 passed / 7 skipped, 34 files), THEN the check that matters:
`HARNESS_TRIALS=3 HARNESS_OLLAMA_CHAT_MODEL=llama3.2:3b,qwen2.5-coder:3b-instruct npx tsx scripts/smoke-plan.ts` and paste the whole output.
**Next up:** 4.2 executor, ideally after seeing that output: if neither 3B model can produce a valid plan, the planner needs a stronger model
(an OpenRouter free model for planning only) and that changes 4.2's assumptions. Still open: memory scoping (blocks 4.3's last criterion and 4.4);
I proceeded because 4.1 does not depend on it. Also open: executor failure policy (retry / abort / skip: which default?).

## 2026-10-04 (end of day) — real-model reruns in; Phase 4 started with 4.3 (D-068, D-069, D-070, DBG-043)
Owner's Windows run of the 3.6+recovery tree: 599 passed / 7 skipped (as predicted). Real-model run 2 (D-070): `tools` capability IS listed
for qwen2.5-coder:3b, so the hypothesis failed; it still writes calls as text (38/38 recovered). llama3.2:3b used the native channel and
passed the single-lookup case 3/3. Neither followed a hot rule; load_skill use 1/3 each. n=3, so counts not rates.
**Found a bug while starting Phase 4:** the loop ran tools the model was not offered. Fixed (D-068).
**Built:** 4.3 `subagent-scope` (D-069), tools only. 15 tests, 8 mutations caught. Linux 523 passed / 98 skipped.
**Verified on Windows:** 614 passed / 7 skipped, 33 files, typecheck clean; D-068 mutation reproduced by the owner (3 fail, restored 15/15).
**Next up:** 4.1 planner. Design constraint from D-070: workers are weak, so the plan is a schema-validated list of narrow subtasks and an
invalid plan is rejected, not executed. Open owner decisions: (a) memory scoping: add a scope key to memory, or declare memory shared in v1
(blocks 4.3's last criterion and 4.4)? (b) which model plans: the same 3B worker, or a stronger one (an OpenRouter free model) for planning only?

## 2026-10-04 (late night) — 3.6 verified on Windows; FIRST REAL-MODEL RUN FOUND A FAILURE; recovery built (D-067, DBG-042)
3.6 verified: 586 passed / 7 skipped. Real-model run 1 (qwen2.5-coder:3b-instruct): NO tool call ran in any trial; the model wrote
calls as text, so the loop treated them as answers. Memory and skills results are therefore uninformative for this model so far.
Built opt-in `textToolCalls` recovery for the Ollama provider (strict, all-or-nothing, logged). Linux sandbox 508 passed / 98 skipped.
**Owner to run (Git Bash):**
1. `npm install`, `npm run typecheck`, `npm test` (expect 599 passed / 7 skipped, 32 test files including the new `ollama-text-tool-calls.test.ts`)
2. `ollama show qwen2.5-coder:3b-instruct` and paste it (is "tools" listed under Capabilities? it tests the hypothesis)
3. `HARNESS_TEXT_TOOL_CALLS=1 HARNESS_TRIALS=3 HARNESS_OLLAMA_CHAT_MODEL=qwen2.5-coder:3b-instruct npx tsx scripts/smoke-real-model.ts`
4. the same without `HARNESS_TEXT_TOOL_CALLS` for `llama3.2:3b` (it may use the tool channel natively): `HARNESS_TRIALS=3 HARNESS_OLLAMA_CHAT_MODEL=llama3.2:3b npx tsx scripts/smoke-real-model.ts`
**Decision waiting on the output:** which model is the reference worker (D-030 assumed qwen2.5-coder:3b; that assumption failed its
first test). Phase 4 should not start until some model has been seen to call tools and use memory/skills.

## 2026-10-04 (night) — real-model script ready; 3.6 still unverified on Windows (DBG-041)
The owner's latest `npm test` output was the 3.5 tree (577 passed, 30 files, no `memory-integration.test.ts`), so 3.6 is NOT
verified there yet: re-extract `Harness-phase3.6.zip` (it now also contains the real-model script) and rerun; expect 586 passed / 7 skipped, 31 files.
`ollama list` shows: nomic-embed-text, qwen2.5-coder:3b-instruct (D-030 reference worker), llama3.2:3b.
**Owner to run (Git Bash), in this order:**
1. `HARNESS_TRIALS=3 HARNESS_OLLAMA_CHAT_MODEL=qwen2.5-coder:3b-instruct npx tsx scripts/smoke-real-model.ts` (quick first look; the first trial includes model load time)
2. if that works, the fuller run: `HARNESS_OLLAMA_CHAT_MODEL=qwen2.5-coder:3b-instruct,llama3.2:3b npx tsx scripts/smoke-real-model.ts` (n=5 each; allow a long time on CPU)
Paste the whole output. `ollama serve` must be running.
**Next up:** decide Phase 4 vs fixing what the real run exposes, once the output is in. Do not start Phase 4 on the assumption that a 3B model drives the loop well.

## 2026-10-04 (later) — 3.5 verified on Windows; 3.6 built; PHASE 3 BUILT (D-066, DBG-040)
3.5 confirmed on the owner's Windows run: 577 passed / 7 skipped, as predicted.
3.6: two-session integration test with a stand-in model, 4 controls, poisoning demo. Plumbing only (D-066). Added a missing
crash-recovery test for compaction (found by a surviving mutation). Readme rewritten to match reality. Linux sandbox 495
passed / 98 skipped.
**Owner to run (Git Bash):** `npm install`, `npm run typecheck`, `npm test`; expect 586 passed / 7 skipped.
**Phase 3 summary:** 3.1-3.6 built; 3.1-3.5 verified on Windows; 3.3 also on a real embedding model. NOT shown: that a real
chat model changes behaviour because of memory or calls `load_skill`; nothing writes lessons; compaction/skills are
prompt-poisoning surfaces with partial mitigation; no profile wires memory or skills (profile-coding is Phase 5's finish line).
**Next up:** Phase 4 (orchestrator + sub-agents) or, first, closing the gaps above. My recommendation: before Phase 4, run a
real chat model through the loop once (`HARNESS_OLLAMA_CHAT_MODEL`): it is the largest unverified claim in the whole project
(Phases 1-3 have never had a real model drive the loop), and Phase 4 multiplies whatever is wrong with it. Open questions for
the owner: (a) which chat model is installed (`ollama list`)? (b) do you want that real-model run before Phase 4, or Phase 4 first?

## 2026-10-04 — 3.4 verified on Windows; 3.5 skills bundle built (D-065, DBG-039)
3.4 confirmed on the owner's Windows run: 546 passed / 7 skipped, as predicted.
3.5: `ctx.skills` per the real Agent Skills spec: index (level 1), `load_skill` (level 2), `read_skill_resource` (level 3),
spec validation with reported problems, restricted YAML reader, confined read-only resource access, optional
host-side `autoLoad` with keyword and embedding matchers. 31 new tests, 21 mutations all caught. Linux sandbox 486 passed / 98 skipped.
**Owner to run (Git Bash):** `npm install`, `npm run typecheck`, `npm test`; expect 577 passed / 7 skipped.
**Not verified (needs a real model):** does a real chat model call `load_skill` unprompted (needs `HARNESS_OLLAMA_CHAT_MODEL`,
open since Phase 2), and does `embeddingMatcher` behave on a real embedding model. Unit tests use scripted stand-ins.
**Next up:** 3.6 memory-system integration test: "prove memory improves outcomes across sessions, not just accumulates".
Open design questions for the owner: (a) what is the measurable outcome? With a scripted model, "improved" can only mean
the right context reached the model, which is plumbing, not improvement. A real chat model on a fixed task set, with and
without memory, is the honest test but needs HARNESS_OLLAMA_CHAT_MODEL and costs time; (b) lessons: something must write
them (D-064). I lean: build the scripted-model plumbing test now (fact stored in session 1 reaches session 2 and changes
the answer) and clearly label it as plumbing; defer the real-model before/after to Phase 6.

## 2026-10-03 (late) — 3.3 closed; 3.4 compaction built (D-064, DBG-038)
3.3: owner's rerun confirmed `free-tier` outranked `retry` (ambiguous query); all real-model checks pass.
3.4: `ctx.memory.compact()` (+ optional `compaction.everyTurns`), exact-normalised lesson matching, ledger so removed rules
stay removed, promoted rules at priority -1, `dryRun`/`approve`. 16 new tests, 12 mutations all caught. Linux sandbox
455 passed / 98 skipped.
**Owner to run (Git Bash):** `npm install`, `npm run typecheck`, `npm test`; expect 546 passed / 7 skipped.
**Honest limits:** (1) nothing writes lessons yet, so compaction is inert in real use until a lesson source exists;
(2) auto-promotion into every system prompt is a poisoning path (D-064) with only partial mitigation; (3) no `ctx.jobs`
and no wall-clock schedule; (4) hot tier only, procedural comes with 3.5.
**Next up:** 3.5 skills bundle (Agent Skills spec: SKILL.md, progressive disclosure). Open design questions for the owner:
(a) where do skill folders live (a project `skills/` dir, a user-level dir, or both)? (b) what makes "the task matches a
skill's description": embedding similarity (reuses `ctx.embeddings`, needs a minScore, and I have one measured data point
for nomic: ~0.48) or simple keyword matching first? I lean embeddings with an explicit threshold plus an exact-name override.

## 2026-10-03 (night) — 3.3 verified against a real model, with one caveat (DBG-037)
Owner's Ollama run: 6/6 facts found, 5/6 first (one ambiguous miss at rank 2), real matches 0.531-0.614 vs unrelated
0.428-0.437. 3.3 is DONE on the criterion "found by a differently-worded query". The gate was relaxed from top-1 to
top-3 after the result (disclosed in the script and DBG-037). Optional rerun to see which fact beat `retry`:
`HARNESS_OLLAMA_EMBED_MODEL=nomic-embed-text npx tsx scripts/smoke-phase3.ts`.
**Next up:** 3.4 compaction. Still waiting on the owner's answers: (a) same lesson = exact text or similarity?
(b) schedule trigger (manual / every N turns / wall clock; there is no `ctx.jobs` yet)? (c) who writes lessons, since
they are caller-supplied only (D-061)?

## 2026-10-03 (evening) — 3.3 Windows run: 530 passed / 7 skipped on rerun; real-model check still pending (DBG-036)
Owner's Windows run: first `npm test` had 1 timeout (cold LanceDB load, my test lacked the project's `vi.setConfig`
timeout; fixed), rerun 530 passed / 7 skipped. The smoke script ran offline because the shell was Git Bash (see below),
so paraphrase retrieval on a real model is STILL UNVERIFIED.
**Owner to run (Git Bash syntax):** `HARNESS_OLLAMA_EMBED_MODEL=nomic-embed-text npx tsx scripts/smoke-phase3.ts`
(PowerShell: `$env:HARNESS_OLLAMA_EMBED_MODEL="nomic-embed-text"` on its own line, then the npx line). Needs `ollama serve`
running and the model pulled. Paste the output.

## 2026-10-03 (later still) — 3.2 verified on Windows; 3.3 semantic tier built (D-063, DBG-035)
3.2 confirmed on the owner's Windows run: 518 passed / 7 skipped (as predicted), typecheck clean.
3.3: `ctx.memorySemantic` (add/query/reindex/remove/list), facts in `semantic.json`, LanceDB collection as a derived
index, `why` required, redaction, outage- and model-change-safe. 12 new tests, 13 mutations all caught. Linux sandbox
439 passed / 98 skipped.
**Owner to run (Windows):** `npm install`, `npm run typecheck`, `npm test` (expect 530 passed / 7 skipped), THEN the real
check, which is the one that matters for 3.3:
`$env:HARNESS_OLLAMA_EMBED_MODEL="nomic-embed-text"` then `npx tsx scripts/smoke-phase3.ts`. Paste the output. Until that
passes, "finds paraphrases" is only shown for a stand-in embedder, not a real one.
**Next up:** 3.4 compaction job (scheduled; promotes repeated episodic lessons into hot rules or procedures). Open design
questions for the owner: (a) what is "the same lesson" - exact text, or similarity (needs embedding episodes, which 3.1
deliberately did not do)? (b) what is the schedule trigger (`ctx.jobs` does not exist in this repo yet; N turns, wall
clock, or manual call)? (c) because lessons are caller-supplied only (D-061), compaction has nothing to promote until
something writes lessons; who will?

## 2026-10-03 (later) — 3.1 verified on Windows; 3.2 hot tier built (D-062, DBG-034)
3.1 confirmed by the owner's Windows run: 501 passed / 7 skipped, typecheck clean (as predicted).
3.2: `ctx.memory.hot` (add/replace/remove/list/render), token-capped (estimate chars/3, default 2000), whole-entry
priority trimming, injected into every agent run through the new `ctx.agentLoop.addSystemSection()`. 17 new tests,
9 mutations all caught. Linux sandbox 427 passed / 98 skipped.
**Owner to run (PowerShell, separate lines):** `npm install`, `npm run typecheck`, `npm test`; expect 518 passed / 7 skipped.
**Next up:** 3.3 semantic tier (architecture facts, only when non-trivial to reconstruct from code; backed by
`ctx.vectorstore`, so it needs `ctx.embeddings`). Open design question for the owner: who decides a fact is
"non-trivial to reconstruct from code" - the caller explicitly, or an automatic check? (I lean explicit caller +
a cheap guard that refuses facts already answerable by grep of the repo; automatic judgment would need a model call.)

## 2026-10-03 — Phase 3 started: 3.1 episodic memory built (D-061, DBG-033)
`bundle-memory` / `ctx.memory.episodic` written: `ctx.memory.runTurn()` runs a turn through the agent loop and
writes exactly one linked entry (task, approach from the log, result, outcome, optional caller-supplied lesson),
idempotent, redacted, JSONL-persisted, queryable by session/agent/task/outcome/time. Typecheck clean; 12 new
tests mutation-checked. Linux sandbox total 410 passed (98 skipped: no ripgrep there).
**Owner to run (Windows PowerShell, separate lines):** `npm install`, `npm run typecheck`, `npm test` and paste
the totals (expected roughly 501 passed / 7 skipped: 489 + 12).
**Still open from Phase 2:** a real chat model driving the loop (`HARNESS_OLLAMA_CHAT_MODEL`), `ollama list` for
the D-027 pin, a labelled retrieval benchmark (Phase 6), whether a 6-minute first index is acceptable.
**Next up:** 3.2 hot tier (token-capped, injected into the system prompt). Open design question for the owner:
what counts as a token when there is no tokenizer (D-061 did not need one; 3.2 does).

## 2026-10-01 (later) — Windows run of 2.6 passed; calibration and indexing cost measured (D-060)
Owner's Windows run: everything passed, including the 2.5/2.6 smoke checks with real
nomic-embed-text. Results led to D-060: similarity floor 0.60 for nomic (answerable 0.70-0.74
vs unanswerable 0.48-0.52), weight 0.5 stays the default, and indexing `src/` took 357 s,
so indexing is now incremental (unchanged files cost nothing; measured 0 embedded in 0.5 s).
Suite 489 passed / 7 skipped on Linux.
**Still open:** a real chat model driving the loop (`HARNESS_OLLAMA_CHAT_MODEL`, the true test
of 2.6), `ollama list` for the D-027 model pin, a labelled retrieval benchmark (Phase 6), and
whether a 6-minute first index is acceptable.
**Next up:** Phase 3 (memory + skills), or policy-gate coverage of the retrieval tools first.

## 2026-10-01 — Phase 2: 2.6 built; Phase 2 code complete pending the owner's runs (D-058, D-059)
`retrieval-tools` (`search_code`, `list_code_files`, read-only, nonce-fenced untrusted
data, bounded output) and the 2.6 end-to-end tests are written: the real agent loop,
registry, log and LLM service driving the full retrieval stack through a scripted,
context-faithful model, with negative controls. Suite 475 passed / 7 skipped.
**Owner to run (Windows PowerShell, separate lines):** `npm install`, `npm run typecheck`,
`npm test`, then `$env:HARNESS_OLLAMA_EMBED_MODEL="nomic-embed-text"` and
`npx tsx scripts/smoke-phase2.ts`. Please paste (a) the new "similarity of the best vector
match" table so a `minVectorScore` can be chosen (D-059), (b) the 2.5 top-3 lines at
weights 0 / 0.5 / 1, (c) `ollama list` (D-027 pin). Optional and the real test of 2.6:
`ollama pull` a chat model that supports tools, set `HARNESS_OLLAMA_CHAT_MODEL`, rerun.
**Phase 2 exit check:** every sub-phase has code and tests; open items are the owner's
runs above, a floor value, a labelled benchmark (Phase 6) and the embedding-model pin.
**Next up:** Phase 3 (memory + skills) per `docs/phases.md`, or first the policy-gate
coverage of the retrieval tools if Phase 5 is pulled forward.

## 2026-09-30 (before) — Phase 2: 2.1-2.4 verified on Windows; 2.5 built (D-056, D-057)
The owner's Windows run passed everything for 2.1-2.4 (DBG-030, D-057).
`retrieval-rank` is written: lexical candidates, BM25, optional vector side,
weighted rank fusion, content-hashed chunk ids so nothing stale is served;
`retrievalGrep.listFiles` added. Suite 439 passed / 6 skipped. **Owner to run:**
`npx tsx scripts/smoke-phase2.ts` with `HARNESS_OLLAMA_EMBED_MODEL=nomic-embed-text`
(it now indexes `src/`, takes a minute or so, and prints the top results for four
questions at weight 0, 0.5 and 1: please judge whether weight 0.5 or 1 beats 0),
and paste `ollama list` so the model digest can be pinned (D-027).
**Next up:** the read-only retrieval tool wrappers (they register `search_code`
and friends on `ctx.tools` with the right action class; the path and secret
protections already live in the bundles), then 2.6 (agent loop integration test).

## 2026-09-30 (later still) — Phase 2: 2.4 built (D-055)
`vectorstore-lancedb` written on embedded LanceDB pinned to 0.30.0 (D-055 has
the reason); fingerprint-guarded collections, source-scoped delete and query.
Suite 376 passed / 6 skipped. The smoke script now covers parse -> embed ->
store -> query -> restart -> wrong-fingerprint -> delete. **Owner to run** on
Windows: `npm install` (fetches the win32 binary), then the smoke script.
2.1-2.4 are all still awaiting that run.
**Next up:** 2.5 rank (BM25 over grep + parse candidates, hybrid with vector
similarity only when `ctx.embeddings` and the store work), the read-only
retrieval tool wrappers, then 2.6.

## 2026-09-30 (later) — Phase 2: 2.3 built (D-054)
`embeddings` written: Ollama provider (real-HTTP tested), hashing stand-in,
batching/dedupe/fingerprint. Suite 343 passed / 6 skipped. **Owner to run:**
`scripts/smoke-phase2.ts` and the opt-in Ollama tests on Windows (rg.exe,
`ollama pull`), then pin the embedding model digest (D-027). 2.1 and 2.2 also
still await that Windows run.
**Next up:** 2.5 rank (BM25 only, embeddings optional and used only when
`ctx.embeddings` works), retrieval tool wrappers (read-only, root/secret
protections), then 2.6; 2.4 (LanceDB) after that.

## 2026-09-30 — Phase 2: 2.1 and 2.2 built (D-051, D-052, D-053)
`retrieval-grep` (2.1) and `retrieval-treesitter` (2.2) are written and tested
against real ripgrep and real grammars; suite 306 passed / 3 skipped, `tsc`
clean. Neither is wired into a profile or exposed as a model tool yet. Not yet
run on the owner's Windows machine. Phase 1 carry-overs: 1B.4, 1.2b, Qwen
license (D-049).
**Next up:** the order changes (D-051 area): 2.5 rank (BM25 only, embeddings
optional, per D-028) before 2.3/2.4, then read-only retrieval tool wrappers
with root/secret protections (not in any phase's file list yet), then 2.6.

## 2026-09-29 (last) — Needle pinned (D-050)
1B.3 is complete. Remaining for Phase 1: confirm Tauri and build 1B.4, live
OpenRouter call (1.2b). Qwen reference worker must be replaced/licensed before
commercial release (D-049).

## 2026-09-29 (late) — Needle generation chosen; Phase 1 close-out list
Owner chose needle2 and confirmed commercial use is in scope (D-049). Needle pin
still needs `npm run pin` on the downloaded files. Remaining to close Phase 1:
Needle pin (1B.3), confirm Tauri and build the desktop app (1B.4), a live
OpenRouter call (1.2b, unverified 429 heuristic). Qwen reference worker must be
replaced or licensed before any commercial release.

## 2026-09-29 (night) — bench complete; Tauri chosen provisionally (D-048)
Valid numbers in hand. Tauri chosen provisionally, pending a measurement of the
Node core as a sidecar. **Open, needing you:** confirm or reject Tauri; Needle
generation + `npm run pin`; Qwen commercial-use question.

## 2026-09-29 (evening) — first bench numbers; memory measurement fixed
Sizes and start times recorded, idle memory invalid (0.0) and fixed (D-047).
No shell chosen. **Open, needing you:** rerun `npm run measure:electron` and
`measure:tauri`, paste `results.csv`; Needle generation + `npm run pin`;
whether commercial use of the Qwen reference worker is ever needed.

## 2026-09-29 (later) — audit gap fixed; 1B.4 toolkit; Needle sources found
Blocked budget calls now log `budget.blocked` (D-044). 1B.4 measurement
scripts written but not run (D-045). Needle: real sources and Apache-2.0 tags
found for needle2/needle3, but no pin - needs a download on your machine, and a
choice of which generation (D-046). Suite 247/3.
**Open, all needing you:** run the two bench scripts and paste `results.csv`;
pick a Needle generation, download it, run `npm run pin`.

## 2026-09-29 — 1B.2 closed; installed-vs-pinned; timeout fix
Added `harness run` (one real call, budget spent first) and used it to
close 1B.2's offline-start and budget-stop tests. `doctor` now compares the
pinned model against what Ollama reports as installed. Local connection
timeout raised to 120 s. Suite 247 passed / 3 skipped (D-043, DBG-021).
**Open:** Needle pin (needs your source/digest, deferred to 4.5); first real
`run` against your Ollama; 1B.4 desktop shell (needs your 8 GB machine).

## 2026-09-28 — 1B.3: real reference-worker pin registered
Real digests from your `ollama pull` are now in `model-store/pins.ts`; the
wizard shows the `worker` binding in `doctor`. **License finding:** the
model is under the Qwen Research License - non-commercial use only (D-042).
Tests 236 passed / 3 skipped. Open: Needle pin (deferred to 4.5); no
installed-vs-pinned check; 1B.2's offline-start/budget-stop tests still
wait on a "run a task" command.

## 2026-09-27 — 1B.3: model store built — mechanism done, one data gap open
**Current phase:** 1B.2 is substantively complete (open items noted last
entry). 1B.3 (model store and pinning, D-027) is now built: `ctx.modelStore`
(`src/bundles/model-store/`) registers models against a fixed source
allowlist (`ollama-library`, `ornith-ai`, `cactus-compute`), verifies a
digest against its pin (refuses any mismatch), and resolves each named
binding to its pin, a registered fallback, or "unavailable" -
`doctor`'s `models` field (new, optional) now reports this when a
`ModelStore` is passed in.
**Open by design, not oversight:** the store ships with **zero
pre-registered models**. D-026 (Needle) and D-030 (the reference worker,
`qwen2.5-coder:3b-instruct`) both name a model but neither recorded a
checked SHA-256 for a specific pulled revision, and this environment has
no network access to Ollama's registry or Hugging Face to compute one for
real. Registering an invented digest would be a fabricated claim - the
same thing `consent-copy.ts` already refuses to do for a provider's
privacy policy (D-020, D-037), just for a hash instead. So 1B.3's third
success criterion ("Needle version and license file recorded") is
genuinely open, not just untested - it needs someone with real network
access to actually pull the models and register their real digests. See
`docs/phases.md` 1B.3 for the full breakdown of what's done vs. open.
**Last debug:** DBG-019 — see `docs/debug.md`. Also caught, while writing
that entry: `docs/architecture.md` hadn't been updated since 2026-09-24 -
three sessions' worth of 1B.2 work (provider connection test, `doctor`,
the wizard CLI) had gone undocumented there even though every one of them
updated `phases.md`/`decisions.md`/`debug.md`/`status.md`. Fixed in this
same pass; worth remembering to check that file on every future slice.
**Last decisions:** D-041 — the fixed source allowlist, why no models are
pre-registered, why the store is in-memory only, `doctor`'s new optional
`models` parameter.
**Test state:** 234 passed, 3 skipped (up from 215/3). `tsc --noEmit`
clean. Three mutations (disable the allowlist check; disable the digest
comparison; make `doctor`'s `models` field default to `[]` instead of
staying absent) each broke the test written for it.
**Watch:**
- `ModelStore` is not wired into `src/cli/wizard.ts` yet - the wizard
  never constructs one, so `doctor`'s `models` field stays absent on
  every real wizard run today. Wiring it in (and deciding what, if
  anything, the wizard should ask about model pinning) is open.
- No persistence to disk - a `ModelStore` is empty again on every
  restart. Not worth building against zero real data (same reasoning as
  the pre-registration gap above); revisit once real pins exist.
- Router (Phase 4.5, Needle) depends on this bundle and is still
  unstarted - unaffected by today's gap since it was already blocked on
  much more than a recorded digest.
**Next up:** either (a) get real network access to compute real digests
for the reference worker and Needle and close 1B.3's open criterion, (b)
wire `ModelStore` into the wizard, or (c) move on to a different phase
entirely (Phase 4.5/router still needs `bundle-model-store` but has its
own larger unstarted scope; Phase 2/retrieval and Phase 5/sandbox remain
fully unstarted). Your call.

## 2026-09-26 — 1B.2: terminal wizard CLI done (slice 6) — every listed 1B.2 piece now built
**Current phase:** 1B.2 substantively complete. Every piece
`docs/phases.md` originally listed for this phase is now built: budgets,
credentials, consent copy, the provider connection test, `doctor`, and now
the terminal wizard CLI that actually wires the first four together and
ends with the fifth. Only offline-start and budget-stop *integration*
tests remain open, and both wait on a "run a task" command that doesn't
exist yet.
`npm run wizard` (`src/cli/index.ts`) walks: project ID → provider choice
(mock/ollama/openai-compatible) → credential storage (with a round-trip
check before ever using the key) → the connection test (D-038's
`acknowledgeRemote` gate for remote providers) → the consent screen →
an optional daily budget → a final `doctor` report. This is the first
place `EgressPolicy` and `AppCore` are booted onto the same `Context`
together — `bootProfileMinimal` still doesn't touch `AppCore` (unchanged
from D-039). Deliberately setup-only: doesn't register the provider on
`ctx.llm`, doesn't boot `LLMService`, doesn't run anything.
**Last debug:** DBG-018 — see `docs/debug.md`.
**Last decisions:** D-040 — why setup-only, why `WizardIO` is an
abstraction over the real terminal, why `TerminalIO`'s `secret` option
doesn't actually mask input, and two things found by hand (a Node
`readline/promises` limitation with piped stdin, and a real
`process.exit()`-truncates-piped-stdout bug, now fixed).
**Test state:** 215 passed, 3 skipped (up from 203/3). `tsc --noEmit`
clean. Two mutations (disable the credential round-trip guard; hardcode
`acknowledgeRemote = true`) each broke the test written for it.
**Watch:**
- `TerminalIO`/`index.ts` (the real terminal I/O) are not exercised by the
  automated suite at all — `test/wizard.test.ts` tests `runWizard` through
  the `WizardIO` interface with a scripted fake. Real terminal behavior
  was verified once, by hand, via a pty (Python's `pty` module driving the
  actual CLI with delayed scripted keystrokes) — confirmed working
  end-to-end for the mock-provider path, exit status 0. Not something CI
  re-checks on every run.
- A plain piped/non-interactive invocation of the real CLI (`echo ... |
  npm run wizard`) does **not** work — Node's `readline/promises`
  `question()` hangs after the first call on non-TTY stdin. Confirmed this
  is a Node limitation, not a bug in this code, by reproducing it in a
  4-line isolated script and then showing the identical input works fine
  over a real pty. No scripted/CI-driven E2E test of the real CLI is
  possible without building a pty-based test harness — judged out of
  scope for this slice.
- `TerminalIO`'s `secret: true` prompt option does not mask input (no
  asterisks) — only prints a one-line warning first. Documented, not
  hidden (D-040).
**Next up:** offline-start and budget-stop integration tests, both of
which need something that actually calls a provider through `LLMService`
to integrate against — likely means building a minimal "run" command
first (out of scope of anything decided so far, would need its own
phases.md entry / decision before starting).

## 2026-09-26 — 1B.2: `doctor` done (slice 5) — every standalone 1B.2 piece now built
**Current phase:** 1B.2, still in progress — but every piece except the
CLI client itself is now done.
`ctx.appCore.doctor(egress)` gives a read-only report: budgets remaining
(`Budgets.status()`/`requestsLeftToday()`, already existed), which
credential backend is active (new `describeCredentialStore` +
`AutoCredentialStore.which()`), current consent state and the egress
allowlist (new, read-only `EgressPolicy.status()`). Deliberately scoped to
what's built — no "active binding", remote-sandbox, or pinned-model/offline
reporting, since none of those exist yet (D-039); extends when 1B.3 and
Phase 5 land, not before.
**Last debug:** DBG-017 — see `docs/debug.md`.
**Last decisions:** D-039 — scope boundary for `doctor`, and why it takes
`egress` as a parameter rather than reading `ctx.egress` (same reason
`consentScreen` does: `bundle-app-core` isn't wired into any profile yet).
**Test state:** 203 passed, 3 skipped (up from 190/3). `tsc --noEmit`
clean. Two mutations (hardcode which credential backend "resolved";
drop `decidedAt` from egress status) each broke the test written for it.
**Watch:**
- `bundle-app-core` is still not booted anywhere (`bootProfileMinimal`
  doesn't call `ctx.plugin(AppCore, ...)`) — every 1B.2 piece so far
  (budgets, credentials, consent copy, connection test, `doctor`) is
  tested standalone, not through a real `ctx`. First real integration
  point is the CLI client.
- `doctor`'s credential-backend detection triggers `AutoCredentialStore`'s
  probe if it hasn't run yet (same cost as any other first call) — calling
  `doctor` is not free the very first time, same documented limitation as
  everywhere else `which()`/`resolve()` shows up.
**Next up:** the terminal wizard CLI client (`src/cli/`) — the thing that
actually wires `ctx.plugin(AppCore, ...)` into a runnable profile and calls
credentials, consent screen, connection test and `doctor` in sequence, then
the offline-start and budget-stop integration tests that depend on it
existing.

## 2026-09-26 — 1B.2: provider connection test done (slice 4)
**Current phase:** 1B.2, still in progress.
`ctx.appCore.testConnection(provider, opts)` lists models (best-effort)
then makes one tiny timed probe call against an already-constructed
`LLMProvider`, and never throws — it returns a structured result the
wizard renders directly. A remote provider needs `acknowledgeRemote: true`,
a narrower one-off gate separate from `ctx.egress`'s persisted per-project
consent, since the connection test has to work *before* that consent
exists (wizard order: connection, then consent). `LLMProvider` gained an
optional `listModels?()`, implemented for `OllamaProvider` and
`OpenAICompatibleProvider`.
**Last debug:** DBG-016 — see `docs/debug.md`.
**Last decisions:** D-038 — the `acknowledgeRemote` gate and why it's
separate from D-029's project consent; the shared listing+probe timeout.
**Test state:** 190 passed, 3 skipped (up from 176/3). `tsc --noEmit`
clean. One mutation (disable the `acknowledgeRemote` gate) broke the test
written for it. One real bug caught by a test hanging on first run (not a
deliberate mutation): model listing had no timeout of its own, so a hung
listing endpoint would have hung the whole connection test forever; fixed
by sharing one deadline across both calls, re-ran clean.
**Watch:**
- Not yet called from anywhere real — no CLI/wizard client exists yet
  (`src/cli/` is still unbuilt). That's next.
- Not tested against a real Ollama or OpenRouter host, only the fetch-mock
  pattern already used elsewhere in the suite — same caveat as 1.2b's
  429-wording heuristic (unverified against the live API).
**Next up:** `doctor` (the other unstarted 1B.2 piece — read-only status
across budgets/credentials/consent/egress allowlist), then the terminal
wizard CLI client (`src/cli/`) that actually calls all four 1B.2 pieces
built so far, then the offline-start and budget-stop integration tests.

## 2026-09-24 — 1B.2: consent-screen copy/data done (slice 3)
**Current phase:** 1B.2, still in progress.
`ctx.appCore.consentScreen(providerName, egress?)` now returns D-020's
general statement plus a specific binding's plain-language destination
plus, only for providers actually checked against a real source
(`ollama`, `openrouter` so far), a dated data-policy claim. An unknown
provider gets an explicit "no checked policy on file" line, not silence
and not a guess.
**Last debug:** DBG-015 — see `docs/debug.md`.
**Last decisions:** D-037 — paraphrased/sourced/dated claims only,
`lookupProviderPolicy` returns `undefined` rather than fabricating
anything for a provider not in the registry.
**Test state:** 176 passed, 3 skipped (up from 169/3). `tsc --noEmit`
clean. Two mutations (fabricate a claim for an unknown provider;
hard-code "local" regardless of actual egress) each broke 2 tests - the
second one is the one that mattered most (a real cloud call falsely
reporting nothing left the machine).
**Not built yet, still open in 1B.2:** provider connection + connection
test; `doctor`; the terminal wizard CLI itself (`src/cli/`);
offline-start test. Budgets, credentials, and consent copy are all
library-grade now but still have no caller - nothing in the codebase
actually presents this consent screen, spends a budget, or reads a
stored key from a real flow yet.
**Next up:** provider connection + connection test is the natural next
slice (the wizard needs something to actually call before it has
anything to show budgets/consent/credentials working against), or
`doctor` (a read-only status check across everything built so far) if the
owner would rather have that first. Confirm before starting.

## 2026-09-24 — 1B.2: credential storage done (slice 2)
**Current phase:** 1B.2, still in progress. `ctx.appCore.credentials`
now exists: `AutoCredentialStore` tries the OS keychain
(`@napi-rs/keyring`), verifies it with a real set/read/compare probe
before trusting it (a broken backend was found, by hand, to fail
*silently* on read in some environments - not a hypothetical), and falls
back automatically to an AES-256-GCM encrypted file when the probe
fails.
**Last debug:** DBG-014 — see `docs/debug.md`.
**Last decisions:** D-036 — verify-don't-trust design for the keychain,
stated (not glossed-over) limitation of the file-store fallback's
encryption, new dependency `@napi-rs/keyring` checked for a Windows
prebuilt binary before adding.
**Test state:** 169 passed, 3 skipped (up from 155/3). `tsc --noEmit`
clean. Two mutations (ignore the probe result; swallow decrypt/tamper
errors) each broke multiple tests.
**Not built yet, still open in 1B.2:** provider connection + connection
test; consent-screen copy/data; `doctor`; the terminal wizard CLI itself
(`src/cli/`); offline-start test; nothing calls `Budgets.spend()` or
`ctx.appCore.credentials` yet from a real flow - both are library-grade
but have no caller until the wizard exists.
**Next up:** continuing 1B.2 - consent-screen copy/data (D-020's "plain
about what the provider receives") is the natural next slice, since
budgets + credentials + egress consent (1B.1) are now all in place for
the wizard to actually present a first-run screen against. Confirm with
the owner before starting.

## 2026-09-24 — 1B.2 started: budgets done, rest of 1B.2 still open
**Current phase:** 1B.2, in progress (not done - it's a multi-piece
phase, sliced same as 1.2b/1.6/1B.1). `bundle-app-core` (`ctx.appCore`)
now exists with `Budgets` (`ctx.appCore.budgets`): task/session/day
soft+hard limits on requests and tokens, a persisted day counter
(survives restart, UTC rollover, mirrors `RateLimiter`'s pattern from
D-023), and an all-or-nothing `spend()` that throws
`BudgetExceededError` with a full status report before recording
anything, if any scope would go over hard.
**Last debug:** DBG-013 — see `docs/debug.md`.
**Last decisions:** D-035 — all-or-nothing spend across scopes (never
leave scopes out of sync with each other); day-counter persistence
copies `RateLimiter`'s design rather than sharing code with it (same
shape, different unit and different consumer).
**Test state:** 155 passed, 3 skipped (up from 140/3). `tsc --noEmit`
clean. Two mutations (disable hard-limit check; break cross-scope
atomicity) each broke several tests.
**Not built yet, still open in 1B.2:** nothing calls `Budgets.spend()`
yet (no real call site to budget-stop test against); provider connection
+ connection test; credential storage (OS credential store + encrypted-
file fallback with a warning); consent-screen copy/data (D-020's "plain
about what the provider receives" requirement); `doctor`; the terminal
wizard CLI itself (`src/cli/`, D-025); offline-start test.
**Next up:** continuing 1B.2 - credential storage is the natural next
slice (budgets and consent both eventually need somewhere to keep a
provider API key; the wizard can't do much without it). Confirm with the
owner before picking a credential-store library, since it likely means a
new dependency and needs to work on the Windows 8 GB target machine
without heavy native build tooling.

## 2026-09-24 — 1B.1 egress controls done
**Current phase:** Phase 1B.1 complete. `bundle-egress` (`ctx.egress`) is
live and mandatory: per-project consent (persisted via `FileConsentStore`
or in-memory for tests), an endpoint allowlist, and redaction of
registered secret values from every outbound request body and the
`model.request` log entry. Sits alongside the existing D-022 binding flag,
not in place of it — both gates must pass for a remote call.
**Last debug:** DBG-012 — see `docs/debug.md`.
**Last decisions:** D-034 — two independent consent gates on purpose (a
binding-config fact vs. a persisted per-project decision), so a refusal's
reason is unambiguous. "Secrets proxy" turned out to already be satisfied
structurally for provider API keys (D-022) — 1B.1's real addition is
`redactValue` for *other* secrets in message/tool content.
**Test state:** 140 passed, 3 skipped (up from 122/3). `tsc --noEmit`
clean. Three separate mutations (bypass project-consent check, bypass
allowlist check, skip redaction) each broke exactly the test built for it.
**Known limitations (not blocking, logged in D-034):**
`FileConsentStore` is a plain JSON file, fine for one process, not
concurrency-safe. Redaction matches literal registered secret values only
— no pattern-based detection of an unregistered credential.
**Not built yet:** consent-screen copy and the interactive wizard (1B.2).
**Next up:** 1B.2 (wizard core, budgets, `doctor`), 1B.3 (model store and
pinning), 1B.4 (desktop shell) remain in Phase 1B, or Phase 2 (retrieval
pipeline) — owner said Phase 2 is next after 1B.1, so that's the plan
unless redirected.

## 2026-09-24 — 1.6 `profile-minimal` done; Phase 1 complete
**Current phase:** Phase 1 (`profile-minimal` kernel) — all of 1.1-1.6 now
Done. `bootProfileMinimal()` composes session-log, model-adapter,
tool-registry, subprocess and agent-loop behind one config call.
**Last debug:** DBG-011 — see `docs/debug.md`.
**Last decisions:** D-033 — `profile-minimal` boots via a plain TS
composer (`ctx.plugin()` × 5), not real `cordis.patch.yml`, because the
loader that mechanism needs (`@cordisjs/plugin-loader` +
`@cordisjs/plugin-include`) is an uninstalled optional peer dependency of
`cordis`. Reopen for `profile-research`/`profile-full` if multiple named,
independently loadable profiles or hot reload become necessary.
**Test state:** 122 passed, 3 skipped (up from 117/3). `tsc --noEmit`
clean. New `test/profile-minimal.test.ts` mutation-checked (a shared-ctx
simulation broke 3 of 5 tests).
**Not built yet:** no real provider (Ollama/OpenRouter) has been run
through the composed profile end-to-end yet - `test/profile-minimal.test.ts`
uses `MockProvider` throughout, same as 1.5. That's naturally covered once
a real task is run against `profile-minimal` with `modelAdapter.ollama`
configured, which isn't blocking (the loop and the wire-format adapters
are each independently tested against real shapes already).
**Open for the owner, unchanged from before:** Electron/Tauri measurement
(D-025), Needle version to pin (D-026), confirm `qwen2.5-coder:3b-instruct`
speed (D-030).
**Next up:** Phase 1B (egress controls, 1B.1) is next per `phases.md` — it
must land before the harness sends real code to a cloud provider — or
Phase 2 (retrieval pipeline) if cloud access isn't needed yet. Confirm
which with the owner before starting.

## 2026-09-22 — D-031 resolved: Windows behavior root-caused, 1.6 un-gated
**What happened:** the owner ran `scripts/diagnose-windows-env.cjs` and
reported the output. It conclusively showed the "leak" is Node's own,
deterministic, platform-mandatory behavior on Windows (11 non-secret
baseline env vars always injected when spawning), not a bug in this
project and not machine-specific — a raw, bundle-independent `spawnSync`
call reproduced it with zero involvement from our code.
**Status change:** 1.4 is now Done and verified on Linux AND Windows
(D-032 supersedes the "not verified" framing in D-031, without deleting
that entry). 1.6 (`profile-minimal`) is un-gated.
**What I did:** added `WINDOWS_REQUIRED_ENV_VARS` as an explicit,
documented, platform-conditional constant; rewrote the security tests to
check the actually-achievable property (nothing beyond the allowlist plus
this fixed, named baseline) via a new `expectChildEnv()` helper, plus a
dedicated test pinning the baseline's exact contents so a future Node
change would surface as a specific failure. Corrected the "not even PATH"
absolute claim in `readme.md`/`code_logic.md` to the precise version.
**Test state:** 117 passed, 3 skipped on Linux (unaffected — the baseline
constant is empty there, so POSIX behavior is unchanged from before any of
this). Mutation-checked that a real full-env leak still fails 5 of 6
security tests even with the new, more permissive-on-Windows helper.
**NOT yet done:** the owner hasn't re-run the actual test suite on Windows
with this fix applied — the analysis is solid from the diagnostic data,
but I'd like that confirmation before calling this fully closed.
**Open for the owner:** run `npx vitest run test/subprocess.test.ts` on
Windows one more time to confirm all 18 pass now; Electron/Tauri
measurement (D-025); Needle version to pin (D-026); confirm
`qwen2.5-coder:3b-instruct` speed (D-030).
**Next up:** 1.6 (`profile-minimal` end-to-end wiring) — no longer blocked.

## 2026-09-22 — 1.5 agent-loop done (built in parallel with the D-031 fix, per owner)
**Current phase:** Phase 1; 1.1–1.5 done. 1.6 (profile-minimal) is next,
but is explicitly gated on D-031 being resolved and re-verified on
Windows first (see phases.md 1.6) — a runnable profile that shells out is
exactly where an unverified env-allowlist would matter for real. 1.5
itself has no dependency on subprocess (only `MockProvider`, `ctx.llm`,
`ctx.tools`), so building it in parallel with the D-031 fix, as the owner
asked, didn't touch anything D-031-related.
**Last debug:** DBG-009 (1.5). D-031 (env-allowlist on Windows) is still
open — see the previous entry below; nothing here resolves it.
**Docs changed:** `phases.md` (1.5 Done, full testing detail; 1.6 marked
gated on D-031), `architecture.md` (agent-loop detail, registered-as-
`ctx.agentLoop` note, file tree), `code_logic.md` (retry/fallback dispatch,
bounded reflection, why no loop-level logging), `debug.md`, this file.
**Test state:** 116 passed, 3 skipped (live). 15 new agent-loop tests,
mutation-checked (skipped retryable check, loosened maxSteps, removed
reflect-once guard, dropped provider override each break the intended
test).
**Not built yet:** no real provider has been run through the loop end to
end (`MockProvider` only); that happens once 1.6 composes
`profile-minimal` — which is blocked on D-031 first.
**Open for the owner, unchanged plus one:** Electron/Tauri measurement
(D-025), Needle version to pin (D-026), confirm `qwen2.5-coder:3b-instruct`
speed (D-030), and — still the most important one — run
`node scripts/diagnose-windows-env.cjs` on Windows and report the output
(D-031), which is what unblocks 1.6.
**Next up:** resolve and re-verify D-031, then 1.6 (`profile-minimal`
end-to-end wiring).

## 2026-09-22 — Windows run found a real gap: env-allowlist not verified there
**What happened:** the owner ran the 1.4 work on their actual Windows
machine (the whole point of testing there). 3 of 5 env-allowlist security
tests failed: a child process received 11 system env vars (PATH, USERNAME,
TEMP, and 8 more) that it should not have, with an empty or near-empty
allowlist. The named test secret did not leak in that run. One passing
test turned out to be weak (checked only one var, not the whole
environment) and has been fixed to check fully.
**Status change:** 1.4 downgraded from "Done" to "Done on Linux, NOT
verified on Windows" (D-031). Don't treat the env-allowlist as a real
security boundary on Windows until this is resolved.
**What I did:** fixed the weak test; wrote and self-tested (on Linux)
`scripts/diagnose-windows-env.cjs`, a dependency-free diagnostic that
isolates whether this is Node/Windows platform behavior or something
specific to this project's code, independent of `src/bundles/subprocess`.
Did NOT ship a guessed fix to the actual leak — I have no Windows machine
to verify one on, and a fix I can't confirm works is worse than an honest
"not yet verified."
**Test state:** 101 passed, 3 skipped on Linux (unchanged, since the fixed
test still passes here). Windows: last known state 98 passed / 3 failed,
pending a re-run after this commit (the fix only closes the assertion gap,
it doesn't address the leak, so 2 of the 3 Windows failures are expected to
still fail until D-031 is resolved).
**Next up, in order:** (1) owner runs
`node scripts/diagnose-windows-env.cjs` on Windows and reports the output —
this decides whether the fix belongs in `Subprocess.run` or somewhere
platform-specific; (2) once resolved and re-verified on Windows, resume 1.5
(agent-loop).

## 2026-09-22 — 1.4 subprocess done
**Current phase:** Phase 1; 1.1 through 1.4 done. Next is 1.5 (agent-loop).
**Last debug:** DBG-007 (1.4). Includes a near-miss note: a doc-editing
script bug briefly truncated `phases.md` to empty; caught via `wc -l`
before commit and reverted with git, nothing lost.
**Last decisions:** none new; D-030 (previous entry) still current.
**Docs changed:** `phases.md` (1.4 marked Done, full detail),
`architecture.md` (subprocess detail, file tree), `code_logic.md` (env
allowlist and result-vs-throw logic), `debug.md`, this file.
**Test state:** 101 passed, 3 skipped (live). 17 new subprocess tests,
mutation-checked (env leak, skipped allowlist guard, swallowed exit code
each break the intended test).
**Not built yet:** no tool wraps `ctx.subprocess` for the agent loop; that
plus the `sandbox-write`/`real-fs-write` action-class call for a shell-out
tool is 1.5 and Phase 5 (`policy-gates`).
**Open for the owner:** unchanged — Electron/Tauri measurement (D-025),
Needle version to pin (D-026), confirm `qwen2.5-coder:3b-instruct` speed
and whether the 7B tag is also worth trying (D-030). Also: run
`npx vitest run test/subprocess.test.ts` on the actual Windows machine to
confirm it behaves the same there (only run in Linux sandbox so far).
**Next up:** 1.5 agent-loop — ReAct loop over 1.2 to 1.4, with the retry
policy from D-023.

## 2026-09-22 — Reference worker: local Ollama, not OpenRouter
**What changed:** the owner checked OpenRouter's model search directly —
"ornith" returns "No results found." Ornith-1.5 9B is confirmed absent from
OpenRouter (closes the open item from D-027 and the prior status entry). The
owner will run a model locally through Ollama for now rather than a cloud
provider. Reference model set to `qwen2.5-coder:3b-instruct` (D-030), sized
for the 8 GB, no-GPU machine; `qwen2.5-coder:7b-instruct` recorded as a
stretch option, not default, since 7B is reported to need the whole 8 GB on
its own with no headroom for the OS, harness host and Needle. No code
changed: `OllamaConfig.model` already takes any tag with no built-in
default (D-018), so this only updates the docs, decisions and status.
**Docs changed:** `decisions.md` (D-030), `trd.md`, `readme.md`.
**Test state:** unchanged, 84 passed, 3 skipped (live).
**Open for the owner:** still the Electron/Tauri measurement (D-025) and
which Needle version to pin (D-026). Confirm `qwen2.5-coder:3b-instruct`
actually runs at an acceptable speed on the 8 GB machine; if it does, decide
whether to also try the 7B tag.
**Next up:** 1.4 subprocess, then 1.5 agent-loop, then 1.6 profile-minimal.

## 2026-09-22 — Cloud provider path, docs brought up to date
**Current phase:** Phase 1; 1.1, 1.2, 1.2b, 1.3 done. Next is 1.4.
**Last debug:** DBG-006 (1.2b).
**Last decisions:** D-020 to D-029: data claim rewritten, provider-agnostic
worker with OpenRouter first, egress consent, rate limiting, sandbox plan
(Crabbox free routes, CubeSandbox and Langfuse deferred), interface plan,
Needle, model pinning, embeddings BM25-first, egress before first cloud run.
**Docs changed:** `context.md`, `decisions.md`, `phases.md` (1.2b, Phase 1B,
4.5, amended 1.5, 2.3, 2.5, 5.1, 5.2, 6.3), `architecture.md` (new planned
bundles, dependency register), `trd.md`, `prd.md`, `appflow.md`,
`code_logic.md`, `workflow.md`, `readme.md`.
**Test state:** 84 passed, 3 skipped (live).
**Watch:**
- Free OpenRouter quota is 50 requests a day (owner chose not to buy the $10
  credit), so live tests must be sparing. Use the mock and recorded fixtures.
- Redaction and the secrets proxy are not built. Do not send real code to a
  cloud provider until 1B.1 exists, or accept that content is unredacted.
- The 429 quota heuristic is unverified against the live API.
**Open for the owner:** is Ornith-1.5 9B listed on OpenRouter for your
account; run the Electron and Tauri measurement on the 8 GB machine; which
Needle version to pin.
**Next up:** 1.4 subprocess (env allowlist security test), then 1.5
agent-loop with the retry policy from D-023, 1.6 profile-minimal, then 1B.1.

## 2026-09-20 — 1.2 done, 1.3 done
**Current phase:** Phase 1; 1.1, 1.2, 1.3 done. Next is 1.4.
**Last debug:** DBG-005 (1.3), DBG-004 (1.2 live).
**Last decisions:** D-019 (tool registry choke point, hooks, required
`actionClass`, `ajv`).
**Watch:** live tool-calling with a real local model is unverified until
1.5; expect ~25s per reply on the current setup.
**Next up:** 1.4 subprocess (env allowlist security test is the important
one), then 1.5 agent-loop, 1.6 profile-minimal.

## 2026-09-20 — 1.2 switched to Ollama
**Current phase:** Phase 1, sub-phase 1.2 (live-call verification pending).
**Last debug:** DBG-003. **Last decisions:** D-018 (Ollama replaces Anthropic).
**Blocked on:** run once with Ollama running and a model installed:
`HARNESS_LIVE=1 OLLAMA_MODEL=<installed tag> npx vitest run test/model-adapter.test.ts`
then log the result and mark 1.2 Done.
**Next up:** 1.3 tool-registry (independent of the live test).

## 2026-09-20 — Sub-phases 1.1 done, 1.2 code-complete
**Current phase:** Phase 1, sub-phase 1.2 (live-call verification pending).
**Last debug:** DBG-002 (1.2), DBG-001 (1.1).
**Last decisions:** D-012 to D-017 (Cordis pin, Bundler resolution, Python
project removed, `ctx.llm` design, adapter-owned logging).
**Blocked on:** run the live test once:
`HARNESS_LIVE=1 ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=... npx vitest run test/model-adapter.test.ts`
and log the result; only then mark 1.2 Done.
**Next up:** 1.3 tool-registry (can proceed in parallel), then 1.4
subprocess, 1.5 agent-loop, 1.6 profile-minimal.

## 2026-09-18 — Docs system scaffolded from design draft
**Current phase:** Pre-Phase 1 — no code yet. Full architecture, bundle
list, profile composition, and guardrail design are locked (see
`docs/decisions.md` D-001 through D-011).
**Last debug:** DBG-000 — docs scaffold only, N/A.
**Last decisions:** D-011 — explicitly out-of-scope repos noted.
**Next up:** Confirm real project root path (currently placeholder
`~/projects/coding-harness`), then hand sub-phase 1.1 (session-log bundle)
to opencode. `docs/phases.md` now breaks every phase into sub-phases with
their own success criteria and tests — work one sub-phase at a time.

---
**Next:** Return to [`context.md`](../context.md).
