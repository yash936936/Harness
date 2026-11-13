# Roadmap decision register: D1-D3

**Status: OWNER DECISIONS RECORDED under D-116 (2026-11-13).** The proposal source is preserved in [`docs/ROADMAP.md`](ROADMAP.md).

| Proposal item | Source wording | Owner disposition | Recorded decision |
|---|---|---|---|
| D1 | Command execution in the prototype | ACCEPT option (a) | No command execution in v0. Read/plan/edit with policy approvals. D-110 remains in force; no host fallback or sandbox probing. |
| D2 | Worker model for acceptance | ACCEPT option (b), restricted | Keep `qwen2.5-coder:3b-instruct` as local/default/headline model. Permit exactly one stronger free OpenRouter comparison session, separately labelled and excluded from local 8 GB and 3B acceptance evidence. |
| D3 | Evaluation size | AMEND option (a) | Three owner-reviewed demo sessions are qualitative only. No scorer output, agreement metrics, or confusion table from three sessions. D-109's ten genuine sessions and label-before-scorer rules remain mandatory for scorer output. |

The owner explicitly approved these dispositions on 2026-11-13. Full rationale, restrictions, unchanged decisions, and affected documents are recorded in the append-only D-116 entry in [`docs/decisions.md`](decisions.md).

D-116 is a scope decision, not acceptance evidence. It does not close S6 or S7, does not authorize command execution, and does not reopen S0/S1/S4. The one-session OpenRouter comparison is not the headline local demonstration.
