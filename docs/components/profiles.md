# Component: profiles

> Area type: support. Location: `src/profiles/`. Hand-written sections describe profile composition and guardrails; generated source details are maintained by `npm run docs:components`.

## Purpose

Composes named Cordis service stacks. `profile-minimal` boots the minimal session, egress, model, tool, subprocess, and agent-loop stack. `profile-coding` boots the governed coding stack with project-root confinement, policy gates, input guarding, memory, retrieval, local tools, orchestration, and evaluation.

The coding profile's boot-time policy enforcement self-test lives in `verify-gates.ts`. The existing `verifyGates` and `SELFTEST_SESSION` exports remain available from `profile-coding.ts` for compatibility.

## Route (how control reaches it)

Callers use `bootProfileMinimal(config)` or `bootProfileCoding(config)`. The coding CLI and tests use `bootProfileCoding`; other integrations can boot the profile directly. Each profile validates that its required services actually started before returning the context.

## Config surface and invariants

- Both profiles require a project ID where egress consent is project-scoped; the coding profile also requires an absolute project root.
- The coding profile refuses unknown options and refuses attempts to disable or weaken the policy gates below the confidence-threshold floor.
- `commandRisk` is always wired into the coding profile's policy signals.
- Service boot order follows dependencies. Sub-agent scope is registered before policy gates; local tools are registered after policy gates.
- Optional skills load only when explicitly configured. Semantic memory loads only when both embeddings and a vector store are configured.
- The coding profile runs `verifyGates` after required services boot and tears down the context if verification fails.

## Known limits

- The profile self-test verifies wiring and policy enforcement in the current context; it does not execute a sandbox command or prove live provider acceptance.
- Scripted tests do not establish live-model compliance or prompt-injection resistance.
- Real sandbox acceptance remains subject to the permanent S0 hold. D-110 and D-114 are unchanged.

---
**Next:** Return to [`context.md`](../../context.md).
