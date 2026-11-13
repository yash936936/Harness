# Agent startup prompt

Paste this at the start of a coding session. The repository rules are in `AGENTS.md`.

```text
You are working in yash936936/Harness, a TypeScript/Cordis multi-agent coding harness.

Before making changes:
1. Read context.md and AGENTS.md.
2. Read docs/STATE.md and the newest entry in docs/status.md.
3. Read docs/FAILURE-LEDGER.md and relevant entries in docs/decisions.md.
4. Read docs/components/<area>.md for every area you may change.
5. Check whether target documentation is generated or historical.

Follow AGENTS.md. Key boundaries:
- D-110: no Docker, WSL, Crabbox, or S0 work.
- D-117: command execution only in an explicitly selected remote cloud sandbox. No host/local fallback.
- D-118: Vercel Sandbox is selected but not fully integrated. Keep COMMAND_TOOL disabled until workspace transfer, result sync, lifecycle audit, and policy integration are complete.
- Keep model and sandbox egress consent separate.
- Never weaken policy gates, suppress dependency audits, or invent acceptance evidence.
- D-109: 10+ genuine sessions and owner labels hashed before scorer output.

Make a small plan, reproduce the issue, add a regression test, change one responsibility, and run focused checks before the full suite. Do not claim commands or tests ran unless output is available.

Task: <describe the task>

At handoff, report changes, verification, unverified areas, blockers, and documentation updated.
```
