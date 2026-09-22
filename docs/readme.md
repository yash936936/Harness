# Coding Harness

A multi-agent orchestration harness for coding tasks, built on Cordis. Every
capability (model access, tools, retrieval, memory, sandboxing, the browser)
is a swappable plugin ("bundle"). Profiles compose bundles into runnable
stacks, from a single-agent smoke-test kernel up to a governed, multi-agent,
multi-user system.

## Status
Phase 1 (the `profile-minimal` kernel) is in progress. Built and tested:

- `ctx.log`: append-only session log with replay and fork (1.1).
- `ctx.llm`: provider registry with Ollama (local), an OpenAI-compatible
  provider (OpenRouter and similar), and a mock (1.2, 1.2b). Includes a
  per-minute and daily rate limiter, typed errors (quota, rate limit,
  payment, consent), and a consent gate for remote hosts.
- `ctx.tools`: tool registry with schema validation, logging and
  pre/post-execute hooks (1.3).

Not built yet: subprocess (1.4), the agent loop (1.5), the runnable
`profile-minimal` (1.6), redaction and the secrets proxy (1B.1), the
first-run wizard (1B.2), retrieval, memory, orchestration, sandboxes,
policy gates, evals and the browser. See `docs/phases.md` and
`docs/status.md`.

## What data leaves your machine
The harness collects no telemetry. What leaves depends on how you set it up:

- **Local model (Ollama on this machine):** model traffic stays on the machine.
- **Cloud model (for example OpenRouter):** what the model sees, including code
  and file excerpts, goes to that provider under its own retention and
  training policy. The harness cannot verify those policies.
- **Remote sandbox (planned):** the repository goes to that sandbox.

A remote provider is refused unless you set `egress: { consent: true }`.
Redaction before sending is not built yet, so until Phase 1B.1 only send
content you are comfortable sharing with the provider.

## Setup
Needs Node 20.3 or newer.

```
npm ci
npm run typecheck
npm test
```

The default run skips live tests. Opt-in live checks:

```
# local Ollama (needs a running server and an installed model)
HARNESS_LIVE=1 OLLAMA_MODEL=<installed tag> npx vitest run test/model-adapter.test.ts

# OpenRouter: spends ONE request of your daily quota
HARNESS_LIVE_OPENROUTER=1 OPENROUTER_API_KEY=... OPENROUTER_MODEL=<exact model id> \
  npx vitest run test/openai-compatible.test.ts
```

Set the API key in an environment variable, not in a file in the repo.

## Free-tier limits to know about
On OpenRouter free models, documentation from September 2026 gives 20
requests per minute and 50 per day (1,000 per day after a one-time $10 of
credit). Limits change. The limiter defaults to 16 per minute and takes a
daily ceiling in config; check the provider for current numbers.

## Structure
See `docs/architecture.md` for full details and the dependency register.

---
**Next:** Return to [`context.md`](../context.md).
