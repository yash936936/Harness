# Roadmap to a sample prototype

Written 2026-11-11 from the repo as uploaded (102 source files, 1137 tests passing / 102 skipped in a sandbox without ripgrep). This is a proposal until the owner accepts D-116; owner decisions are listed in section 4.

## 1. What "sample prototype" means here

> A governed local coding agent: given a task in a real small project, it plans, retrieves context, reads and edits files with human approval for risky writes, refuses dangerous or credential actions, and leaves a complete session log. It runs on the 8 GB, no-GPU machine with `qwen2.5-coder:3b-instruct` through Ollama (OpenRouter optional).

Not part of the prototype: executing the project's tests in a sandbox, multi-user scale, a desktop app, router ownership, browser research, evaluation calibration.

## 2. Scope tiers

| Tier | Meaning | Areas |
|---|---|---|
| **A: prototype core** | Must work, keep full test discipline | `session-log`, `model-adapter` (Ollama), `egress`, `tool-registry`, `policy-gates`, `tools-local` (read/edit/write), `agent-loop`, `orchestrator`, `subagent-scope`, `input-guard`, `retrieval-grep`, `retrieval-treesitter`, `retrieval-rank` (BM25 path), `retrieval-tools`, `app-core` budgets/credentials/consent, `cli` (`harness code`), `profiles` (`profile-coding`) |
| **B: keep, no new work** | Built and CI-tested; do not extend or hand-test further | `memory` (hot, episodic, compaction), `skills`, `embeddings` + `vectorstore-lancedb` (optional vector side), OpenRouter provider (smoke passed), `eval-runner` (scripted), `model-store` |
| **C: cut from the prototype** | Leave in the tree, stop spending owner time, label experimental | `sandbox-crabbox`, `sandbox-cubesandbox` real runs (S0/S1, D-110), Needle router evaluation (`router.owned` stays empty), Tauri/desktop (1B.4), Langfuse, Qdrant, browser tool, multi-user, Qwen 7B (D-114), license closure ENG-04 (deferred by D-115, no distributable artifact) |

## 3. Testing: skip, keep, and change

**Skip (do not run or chase):**
- Real Docker/Crabbox/WSL anything (D-110). CI fakes stay as they are.
- Router vs worker evaluation, Needle wrapper.
- Desktop benchmarks, further lock-stress runs (Windows paused-holder already passed 15/15).
- 7B artifact verification and license-closure archive inspection (D-114, D-115).

**Never skip (security and integrity):** policy gates and deny-list, egress consent and redaction, path confinement and symlink tests in `tools-local`, session-log integrity and torn-tail recovery, input-guard fencing, credential store, the required-sequence and approval logic. These run in CI on both platforms.

**Keep exactly one live check:** S7 rerun on merged main with the 3B model (reads both files, resists the poison, explains `target.ts`). Cheap and the only unmet live item that touches Tier A.

**Change or replace where we keep failing:**

| Problem | Evidence | Proposal |
|---|---|---|
| Sandbox: WSL/Docker/Crabbox failed repeatedly, then held | S0 incident report, failure ledger (3 signatures, on-hold) | Do not fix. Prototype v0 has no command execution (see D1). If wanted later, replace Crabbox with a simpler provider, not more debugging |
| Small-model workarounds accumulating | alias mapping, confidence-string coercion, required-sequence enforcement, planner normalization, post-sequence finalization (DBG-087..101) | Freeze: add no more. Merge them into one documented normalization layer with model-independent tests. Prefer constrained output (the planner already uses `jsonSchema`) over per-mistake patches. Reconsider the model (D2) |
| Self-reported confidence carries no signal | D-079, D-086, D-087 | Keep as a floor only; build session-scoped approvals (D-088 option a) so approval volume is livable |
| Status docs duplicate and contradict | status.md, BUILD-PLAN.md, AUDIT-CLOSEOUT.md carry stacked, partly conflicting entries | One authoritative state table (`docs/STATE.md`, section 6), older entries stay as history |
| Merged-red CI | PR #39, run #369 | Branch protection with `ci-pass`, plus grep tests for old expectations when behaviour changes (AGENTS.md section 6) |

## 4. Owner decisions (with my recommendation and its weak point)

| # | Decision | Options | Recommendation | Counterpoint |
|---|---|---|---|---|
| D1 | Command execution in the prototype | (a) none, v0 is read/plan/edit with approvals; (b) host commands, every command held for explicit approval plus `commandRisk` allowlist; (c) new sandbox provider | (a) now, revisit (b) after the demo | Without running tests the agent cannot verify its own edits, so it is weaker than most coding agents. (b) reopens host execution; the deny-list is known not to catch encoded commands, so safety rests on human attention |
| D2 | Worker model for acceptance | (a) keep 3B only (D-114); (b) allow one stronger free OpenRouter model for one comparison session | (b) for one session | Most workaround churn came from the 3B model. A stronger model weakens the "runs on 8 GB" claim only if used for the headline demo, so keep 3B for that |
| D3 | Evaluation size (S6 stays in scope under D-115) | (a) the 3 demo sessions only, no confusion table; (b) 10 genuine sessions labelled by the owner under D-109 | (a) first, (b) if you want a confusion table | With 3 sessions the scorer is unvalidated; say so in the README. D-109 requires 10 and both labels before any scorer output |

## 5. Phased roadmap

| Phase | Goal | Work | Exit criterion (evidence) |
|---|---|---|---|
| **R0 Hygiene (this run)** | Docs match reality, CI cannot merge red | Docs updated; component docs generated; docs CI job fixed; refactor `tools-local`. Owner: apply patch, branch protection, confirm `ci-pass` | Patch merged, `ci-pass` required, drift check green on main |
| **R1 Decide** | Freeze scope | Owner answers D1-D3; I log D-116 accepted/amended | Decisions in `docs/decisions.md` |
| **R2 Harden core** | Remove the known weak spots in Tier A | S7 live rerun; consolidate normalization layer; session-scoped approvals; header comments and the remaining `(open — …)` component sections; split `retrieval-rank/index.ts` (search vs indexing) | Tests no lower than 1137 passed; `docs:check` green; S7 evidence recorded |
| **R3 Demo** | A reproducible demonstration | Pick one small real project; record 3 end-to-end sessions (one clean, one with an approval denied, one with a credential read blocked); README quickstart for Windows 8 GB; one-page demo script | 3 session JSONLs plus owner-reviewed summary; cold start to first result documented with measured time |
| **R4 Optional extension** (only if owner chooses) | Verify edits | Per D1: host-approved commands, or a new sandbox provider; or 10 labelled sessions; or router measurement | Each is its own gate with raw evidence; failure rule applies (3 repeats = stop) |
| **R5 After prototype** | Product | Desktop shell, packaging and license closure (ENG-04), multi-user, browser tool | Out of scope until R3 is accepted |

## 6. Single state table (replaces reading three files)

| ID | State | Reason |
|---|---|---|
| S0 sandbox | Hold (D-110) | Not pursued |
| S1 orphan reaper | Deferred | Depends on S0 |
| S2 PRs #11/#12 | Closed | Merged, CI green |
| S3 file-tool/policy live | Closed | One 3B session reviewed |
| S4 full provider tasks | Cut from prototype | Needs command execution; smoke passed |
| S5 licensing | Deferred (D-115) | No distributable artifact; ENG-08 out of scope (D-114); inventory kept |
| S6 evaluation | In scope, prototype-grade (D-115, D-109) | Needs owner labels; blocked until sessions and labels exist |
| S7 retrieval/poisoning | Partial: one live rerun left | Embedding run passed; poisoning run incomplete |
| S8 final audit | Reduced to this table | |
| 1B.4 desktop | Cut | Benchmarks only |

---
**Next:** Return to [`context.md`](../context.md).
