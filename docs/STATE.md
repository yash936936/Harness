# Authoritative prototype state

Updated 2026-11-13 after owner approval of D-116. This table is the current compact state reference. Historical details and raw evidence remain in `docs/status.md`, `docs/BUILD-PLAN.md`, and `docs/AUDIT-CLOSEOUT.md`. Green CI is not live acceptance.

## Scope and decisions

| Item | Current state | Evidence / boundary |
|---|---|---|
| D-116 / R1 | OWNER DECISIONS RECORDED | D1 accepted (no command execution); D2 accepted with one restricted stronger free OpenRouter comparison session; D3 amended (three demo sessions, no scorer output). See `docs/decisions.md` and `docs/ROADMAP-DECISIONS.md`. |
| D-110 / D1 | ACCEPTED: NO COMMAND EXECUTION | Prototype v0 is read/plan/edit with policy approvals. No host command execution, sandbox probing, or host fallback. |
| D2 / model comparison | ACCEPTED WITH RESTRICTION | 3B remains the default, local, headline demo model and the only model for 3B-specific acceptance. One stronger free OpenRouter model may be used for one separately labelled comparison session only. It is not headline-demo or local 8 GB evidence. |
| D3 / evaluation | AMENDED | Three demo sessions support a qualitative, owner-reviewed prototype demonstration only. No scorer output, agreement score, or confusion table from three sessions. D-109's ten genuine sessions, both classes, owner labels committed and hashed before scoring remain mandatory for scorer output. |
| Branch protection | OPEN OWNER ACTION | GitHub reported `main.protected=false`; require PRs and `ci-pass`, up-to-date branches, no force-push/deletion, no admin bypass. |
| Distribution | OUT OF SCOPE (D-115) | No distributable artifact planned. License closure is not marked passed. |

## Phase state

| ID | State | Remaining evidence / action |
|---|---|---|
| R0.1 security/execution scope | CLOSED | D-110 restrictions merged in PR #86. |
| R0.2 CI integrity | CODE FIXES VERIFIED; MERGE GATE OPEN | Docs and failure-ledger checks are read-only/blocking; owner must configure branch protection. |
| R0.3 docs synchronization | PARTIAL / IN PROGRESS | Component docs and drift checks passed; this state table is now authoritative. Complete any remaining docs synchronization and merge the documentation branch. |
| R1 owner decisions | CLOSED | D-116 recorded with explicit owner approval. |
| R2 core hardening | PARTIAL | PR #87 hardening and CI are merged. Remaining roadmap items include the S7 live rerun and session-scoped approval work. Retrieval-rank split was reviewed and not adopted; see DBG-120. Do not claim all R2 work complete. |
| R3 demo | NOT STARTED | Need a real small project, three complete session JSONLs (clean, approval denied, credential read blocked), owner-reviewed summary, Windows 8 GB quickstart/demo script, and measured cold-start-to-first-result time. |
| R4 optional extension | NOT AUTHORIZED | Requires separate owner choice and evidence gate. |
| R5 after prototype | OUT OF SCOPE | Productization and distribution deferred. |

## Acceptance evidence

| ID | State | Evidence / boundary |
|---|---|---|
| S0 sandbox | PERMANENT HOLD (D-110) | No Docker/WSL/Crabbox probing or host execution substitutes. |
| S1 orphan reaper | DEFERRED-S0-HOLD | Depends on S0. |
| S2 PRs #11/#12 | CLOSED | Merged and CI green, per historical record. |
| S3 file-tool/policy | CLOSED (D-111) | One owner-reviewed 3B session; does not imply command execution or sandbox acceptance. |
| S4 full provider tasks | PARTIAL / BLOCKED (D-112) | Full target-project test execution requires command execution, which is excluded. |
| S5 licensing | DEFERRED / OUT OF SCOPE (D-115) | No distributable artifact planned; inventory retained. |
| S6 evaluation | OPEN | Three demo sessions are not a scorer dataset. D-109 requires at least 10 distinct genuine sessions, both good and bad labels, owner labels committed and hashed before scorer output. |
| S7 embedding | OPEN / EVIDENCE RECONCILIATION REQUIRED | Existing roadmap says an embedding run passed, while current audit/build-plan records live embedding acceptance as open. Do not claim pass until exact accepted output is reconciled and recorded. |
| S7 poisoning | PARTIAL / RETEST REQUIRED | Fresh owner-run exact 3B poisoning task remains outstanding. Require both ordered reads, poison resistance, accurate target explanation, no credential disclosure, and unchanged fixture hashes. |
| S8 final audit | REDUCED TO STATE TABLE | Final audit remains dependent on outstanding R2/R3 evidence. |
| 1B.4 desktop | CUT | Benchmarks only; no desktop product. |

## Current verified CI baseline

PR #87 merged as `e8614f12e1a66cbea9adfe230a902e1c72f4b9d4`; post-merge Actions run #576 passed all seven jobs. PR #88 documentation follow-up run #577 passed all seven jobs on its branch. PR #88 merge state must be checked before treating its documentation as part of main.
