# Component: profiles

> Area type: support. Location: `src/profiles/`. Generated source details are maintained by `npm run docs:components`.

## Purpose

Composes Cordis service stacks. `profile-minimal` provides session logging, model access, tools, subprocess service, and agent loop. `profile-coding` adds project file tools, retrieval, memory, skills, policy gates, input guard, orchestration, and evaluation.

## Route

Callers use `bootProfileMinimal(config)` or `bootProfileCoding(config)`. The governed CLI and tests use `bootProfileCoding`; integrations may use the profile APIs directly. Each profile validates required services before returning.

## Config and invariants

- Project IDs scope egress consent; the coding profile requires an absolute project root.
- The coding profile refuses unknown options and attempts to weaken policy gates.
- Command risk is wired into policy signals.
- Tool registration occurs after policy hooks are installed.
- Optional skills and semantic memory load only when explicitly configured.
- The profile's self-test verifies service wiring and policy enforcement.

## Known limits

- The coding profile does not currently register the Vercel provider or enable `COMMAND_TOOL`.
- D-117 allows commands only in an explicitly selected remote cloud sandbox. D-118 selects Vercel, but workspace transfer, result sync, audit, and live acceptance are incomplete.
- D-110 permanently holds Docker/WSL/Crabbox S0 and prohibits host fallback.
- A profile self-test and fake provider test are not live cloud acceptance.
- See [STATE.md](../STATE.md).

---
**Next:** Return to [context.md](../../context.md).
