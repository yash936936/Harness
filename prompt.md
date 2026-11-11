# prompt.md — paste-in prompt for any agent

Paste this at the start of a session with any coding agent. The full rules live in `AGENTS.md`; this only gets the agent to read them.

```
You are working in the Harness repository (TypeScript, Cordis, multi-agent coding harness).

Before doing anything:
1. Read AGENTS.md completely, then context.md, then the newest entry in docs/status.md, then docs/FAILURE-LEDGER.md.
2. Read docs/components/<area>.md for each area you will change.
3. Follow AGENTS.md exactly. In particular: evidence classes (green CI is not acceptance), the repeated failure rule (3 identical failures = stop and decide), hard prohibitions (D-110, D-114, no secrets, no weakened gates), and the logging duties.

Task: <describe the task here>

Work in small steps. Log commands through scripts/events/run-logged.mjs. Run the narrowest test first. When finished, report: what changed, what you verified and how, what you did not verify, and which docs you updated.
```

---
**Next:** Return to [`context.md`](./context.md).
