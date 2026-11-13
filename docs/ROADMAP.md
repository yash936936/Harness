# Roadmap to a cloud-executing sample prototype

Updated 2026-11-13 under owner decision D-117. This roadmap supersedes the conflicting D-116 D1/D2 scope statements only where stated in D-117. The current target is a governed coding agent that uses cloud-hosted model inference and executes development commands only inside an isolated remote cloud sandbox.

## 1. Prototype outcome

Given an explicitly selected project snapshot and task, Harness plans, retrieves context, reads and edits files, installs approved dependencies, builds, tests, and performs approved Git operations. Every command runs in a remote cloud sandbox. The host machine is never a command-execution fallback. Risky operations remain policy-gated; hard-denied operations cannot be approved. Each model and sandbox destination has separate project consent and host allowlisting. Every decision and command result is retained in the append-only session log.

The existing Docker/WSL/Crabbox S0 route remains permanently held under D-110. D-117 adds a separate cloud provider route; it does not repair or reopen S0. S1 remains deferred until separately decided.

## 2. Scope tiers

| Tier | Meaning | Areas |
|---|---|---|
| **A: required prototype core** | Must work and pass full test discipline | session-log, model-adapter with cloud endpoint support, egress, tool-registry, policy-gates, tools-local, sandbox remote provider, agent-loop, orchestrator, input-guard, retrieval, profile-coding and governed CLI |
| **B: retain** | Existing capability; extend only where required by D-117 | OpenAI-compatible cloud model provider, Ollama provider subject to cloud-auth compatibility verification, budgets/rate limits, eval-runner |
| **C: out of scope** | No work under this decision | Docker/WSL/Crabbox S0/S1, host command execution, browser research, multi-user scale, desktop app, Qwen 7B artifacts, distribution/release packaging (D-110, D-115) |

## 3. Command execution and security boundaries

- Execution destination: remote cloud sandbox only. No local runtime auto-detection, host subprocess, or fallback.
- Command coverage: full development workflow, including read/search, package installation, build, test, and Git status/diff/branch/commit.
- Invocation: argv only, no implicit shell. Compound commands must be separate calls. No pipes, redirects, command substitution, or shell metacharacter interpretation.
- Policy: classify each operation; enforce hard denials; require explicit approval for high-risk permitted actions using an immutable snapshot of command, args, cwd and policy context.
- Isolation: short-lived per-task workspace, project-only mount, non-root identity, resource limits, bounded processes, timeout, output caps and verified teardown.
- Network: disabled inside sandbox by default. Package registries and any other required network destinations need a separate explicit sandbox-network policy and allowlist.
- Secrets: no ambient host credentials, API keys, SSH agents, sockets or credential stores in the sandbox. No secret injection by default.
- Egress: model provider and sandbox provider are independent remote destinations. Each requires its own consent and host allowlist.
- Audit: record policy, approvals, command argv/cwd, provider/host/lease, timestamps, duration, exit code, timeout, cancellation, bounded redacted output, and release/cleanup status.

## 4. Model testing policy

Use cloud-hosted models for model-driven prototype acceptance. OpenRouter's OpenAI-compatible endpoint is the initial supported route. Ollama-hosted cloud inference may be added only after its authentication and API contract are verified; current Ollama provider code does not yet establish cloud API-key support. Record exact provider, model ID, endpoint host and hosting classification per session. Local Ollama can remain an optional developer tool but is not cloud acceptance evidence. Model egress consent is independent from sandbox egress consent.

D-116 D3 and D-109 remain unchanged: three owner-reviewed demo sessions are qualitative only; scorer output requires at least 10 genuine sessions, both owner labels, and labels committed and hashed before scoring.

## 5. Implementation phases

| Phase | Goal | Work | Exit evidence |
|---|---|---|---|
| **R2.1 Architecture and contract** | Freeze remote execution boundary | Provider contract, workspace lifecycle, consent model, network policy, audit schema, threat model | Reviewed architecture and tests for fail-closed behavior |
| **R2.2 Cloud sandbox adapter** | Implement remote provider | Provider selection/config, create/sync/run/collect/release, health check, resource limits, no host fallback | Provider contract tests and isolated cloud smoke |
| **R2.3 Command policy integration** | Enable full workflow safely | Re-enable COMMAND_TOOL only with configured cloud provider; risk classification, approvals, immutable approval snapshot, hard denials, Git hardening | Policy matrix tests and denied/approved operation traces |
| **R2.4 Audit and egress** | Make remote work inspectable | Separate sandbox/model consent, host allowlists, sandbox network policy, secret redaction, command lifecycle events | Audit schema tests, secret-leak tests, cleanup-failure tests |
| **R2.5 Cloud model integration** | Use cloud models for testing | Verify OpenRouter; evaluate Ollama cloud auth/API; label exact provider/model/hosting | Live model smoke and per-session provenance |
| **R2.6 Governed CLI integration** | Deliver end-to-end workflow | Explicit cloud sandbox/provider flags, consent UX, project snapshot, task lifecycle, fail-closed errors | Clean task, approval-denied task, hard-denied credential task, build/test task |
| **R2.7 Acceptance and CI** | Prove behavior | Full CI on Windows/Ubuntu; live cloud sandbox acceptance; command matrix; audit review; S6/D-109 evidence | CI green plus separately reviewed live evidence; no claim based on fakes alone |

## 6. Explicitly retained decisions

D-110 continues to prohibit Docker/WSL/Crabbox probes and host execution. D-115 keeps distribution out of scope. D-116 D3 and D-109 retain the evaluation evidence threshold. D-117 does not mark S0, S1, S4, S6 or S7 as passed. S4 is reopened only as a planned cloud-sandbox acceptance path.


---

## Historical proposal (2026-11-11)

The earlier D-116 proposal and its original options are retained below for decision history. Where that proposal says no command execution, local 3B-only testing, or S4 cut, D-117 now governs the narrower cloud-only route described above.

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
