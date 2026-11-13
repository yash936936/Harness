# Roadmap decision register: D1-D3

**Status: OWNER DECISIONS RECORDED under D-116 (2026-11-13).** The proposal source is preserved in [`docs/ROADMAP.md`](ROADMAP.md).

| Proposal item | Source wording | Owner disposition | Recorded decision |
|---|---|---|---|
| D1 | Command execution in the prototype | ACCEPT option (a) | No command execution in v0. Read/plan/edit with policy approvals. D-110 remains in force; no host fallback or sandbox probing. |
| D2 | Worker model for acceptance | ACCEPT option (b), restricted | Keep `qwen2.5-coder:3b-instruct` as local/default/headline model. Permit exactly one stronger free OpenRouter comparison session, separately labelled and excluded from local 8 GB and 3B acceptance evidence. |
| D3 | Evaluation size | AMEND option (a) | Three owner-reviewed demo sessions are qualitative only. No scorer output, agreement metrics, or confusion table from three sessions. D-109's ten genuine sessions and label-before-scorer rules remain mandatory for scorer output. |

The owner explicitly approved these dispositions on 2026-11-13. Full rationale, restrictions, unchanged decisions, and affected documents are recorded in the append-only D-116 entry in [`docs/decisions.md`](decisions.md).

D-116 is a scope decision, not acceptance evidence. It does not close S6 or S7, does not authorize command execution, and does not reopen S0/S1/S4. The one-session OpenRouter comparison is not the headline local demonstration.


## D-117 follow-up disposition — 2026-11-13

| Proposal item | Updated owner disposition | Governing record |
|---|---|---|
| D1: command execution | ACCEPTED: remote cloud sandbox only; full development workflow under command policy; no host or local fallback | D-117 |
| D2: model testing | ACCEPTED: cloud-hosted model endpoints are the testing target; verify provider auth/API before claiming compatibility | D-117 |
| D3: evaluation | UNCHANGED: three qualitative demo sessions only; scorer evidence still follows D-109 | D-116 D3 / D-109 |

D-117 supersedes D-116 D1/D2 narrowly. D-110 remains in force for Docker/WSL/Crabbox and host execution. S0 remains PERMANENT-HOLD; S1 remains deferred. S4 is reopened only as a cloud-sandbox acceptance plan and is not passed. D-115 remains unchanged.


## D-118 provider selection — 2026-11-13

| Item | Owner disposition | Boundary |
|---|---|---|
| First D-117 cloud sandbox | ACCEPTED: Vercel Sandbox | Provider-neutral Harness seam remains open for future providers |
| Runtime safety | REQUIRED | Non-persistent sandbox, deny-all network policy, argv-only invocation, confirmed delete |
| CLI command enablement | NOT YET AUTHORIZED BY IMPLEMENTATION EVIDENCE | Keep `COMMAND_TOOL` filtered until safe workspace snapshot/result synchronization and lifecycle audit are complete |
| Live acceptance | OPEN | Requires real Vercel credentials and end-to-end project workflow evidence |

D-118 selects the provider; it does not claim that command execution is complete or S4 passed.
