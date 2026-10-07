# Coding Harness

A multi-agent orchestration harness for coding tasks, built on Cordis. Every
capability (model access, tools, retrieval, memory, sandboxing, the browser)
is a swappable plugin ("bundle"). Profiles compose bundles into runnable
stacks, from a single-agent smoke-test kernel up to a governed, multi-agent,
multi-user system.

## Status
Phases 1 and 2 are done, Phase 3 (memory and skills) is built, and Phase 4 has started (`subagent-scope` with tool and memory scoping, and the planner and the executor exist; see D-069, D-071, D-073, D-075). This file was
behind the code for a while; the per-phase lists below are what exists and is tested. Phase 1 (the `profile-minimal` kernel):

- `ctx.log`: append-only session log with replay and fork (1.1).
- `ctx.llm`: provider registry with Ollama (local), an OpenAI-compatible
  provider (OpenRouter and similar), and a mock (1.2, 1.2b). Includes a
  per-minute and daily rate limiter, typed errors (quota, rate limit,
  payment, consent), and a consent gate for remote hosts. Current reference
  worker: local Ollama, `qwen2.5-coder:3b-instruct` (D-030) — Ornith-1.5 9B
  is confirmed not on OpenRouter and stays benchmark-only.
- `ctx.tools`: tool registry with schema validation, logging and
  pre/post-execute hooks (1.3).
- `ctx.agentLoop`: a ReAct loop over `ctx.llm` and `ctx.tools`, with the
  D-023 retry/fallback policy and a bounded reflection pass (1.5).
- `ctx.subprocess`: local command execution, no shell, env allowlist (1.4).
  Verified on Linux and Windows. On Windows, Node itself always injects a
  fixed, non-secret baseline (about a dozen OS/user-profile vars — never
  secrets) into any spawned process; there is no way to suppress this
  through Node's public API. The allowlist still keeps out everything else,
  including your actual secrets (D-031, D-032).

Phase 2 (retrieval) is in progress:

- `ctx.retrievalGrep`: ripgrep search confined to a root directory, skipping
  secret files by default, ranked by match count (2.1). Needs `rg` installed.
- `ctx.retrievalParse`: symbol outlines (functions, classes, methods, types)
  for TypeScript, TSX, JavaScript and Python via WASM grammars, no native
  build step (2.2).

- `ctx.embeddings`: batched text-to-vector via local Ollama (`/api/embed`),
  identical texts sent once, remote hosts refused (2.3).

- `ctx.vectorstore`: embedded LanceDB store for those vectors; remembers which
  embedding model built a collection and refuses to mix models (2.4). Needs a
  platform that LanceDB has a native build for (Windows x64 is included).

- `ctx.retrievalRank`: ask a question, get the best-matching functions and code
  blocks, ranked by BM25 and (once the project is indexed) vector similarity,
  with a weight to trade one for the other (2.5). Indexing is incremental: the first index of a
  project with a local model takes minutes, later runs only embed what changed.

- `ctx.retrievalTools`: `search_code` and `list_code_files` as read-only agent
  tools, so the agent loop can look up project code itself (2.6). Retrieved code is
  fenced as untrusted data.

Retrieval is connected to the agent loop through those two tools; no profile enables
them yet. A similarity floor for vector results is configurable but unset until it has
been measured (see `docs/decisions.md` D-059). To try them on your machine:
`npx tsx scripts/smoke-phase2.ts`.

Phase 3 (memory and skills), all in `src/bundles/memory/` and `src/bundles/skills/`:

- `ctx.memory.episodic`: one entry per agent turn (task, tools used, answer, outcome, optional lesson), linked to the
  session-log events it covers, append-only, saved to disk (3.1).
- `ctx.memory.hot`: a small set of standing rules shown to the model on every run, under a token cap. The cap is an
  estimate (characters / 3), not a real tokenizer (3.2).
- `ctx.memorySemantic`: facts found by meaning (embeddings + LanceDB). Each fact must say why it is not obvious from the
  code. Checked against a real embedding model (nomic-embed-text): 6 of 6 paraphrased questions found their fact within
  the top 3, 5 of 6 ranked first (3.3).
- `ctx.memory.compact()`: promotes a lesson that recurs in 3 or more episodes into the hot tier, once; a rule you delete
  stays deleted (3.4).
- `ctx.skills`: Agent Skills (agentskills.io): the model sees each skill's name and description, loads instructions with
  `load_skill`, and reads bundled files one at a time. Skills are read, never run (3.5).
- 3.6 integration test: a lesson learned in one session changes the next session's behaviour through the whole chain,
  with controls. It uses a scripted stand-in for the model, so it proves the plumbing, NOT that a real model improves.

Real-model status (read this first): a real model has been run through the loop once. `qwen2.5-coder:3b-instruct` did NOT use
Ollama's tool-call channel (it wrote tool calls as text), so no tool ran and nothing about memory or skills was learned from it. The
Ollama provider has an opt-in `textToolCalls` option that recovers such calls (strictly; see D-067); whether that makes a 3B model
usable is not yet known. Try it: `HARNESS_TEXT_TOOL_CALLS=1 HARNESS_OLLAMA_CHAT_MODEL=<model> npx tsx scripts/smoke-real-model.ts`.

Things to know before relying on Phase 3: nothing in the product writes lessons yet (they only arrive through
`runTurn({ lesson })`), so compaction has nothing to promote in real use until something does. Lessons promoted by
compaction and skills both become text in the system prompt, so a poisoned lesson or skill could steer the model; only
partial protections exist until the policy gates in Phase 5 (see `docs/decisions.md` D-064, D-065). No profile enables
memory or skills yet, and no real chat model has driven the loop.

Not built yet: the Phase 4 router, remote sandboxes (Phase 5.1/5.2), any real-model run of `profile-coding` (it is built and tested with scripted models, D-081), a real sandbox-write or external-side-effect tool, evals (Phase 6),
the browser (Phase 7), multi-user scale (Phase 8). See `docs/phases.md` and `docs/status.md`.

## What data leaves your machine
The harness collects no telemetry. What leaves depends on how you set it up:

- **Local model (Ollama on this machine — the current default, D-030):**
  model traffic stays on the machine.
- **Cloud model (for example OpenRouter):** what the model sees, including code
  and file excerpts, goes to that provider under its own retention and
  training policy. The harness cannot verify those policies.
- **Remote sandbox (planned):** the repository goes to that sandbox.

A remote provider is refused unless you set `egress: { consent: true }`.
Registered secrets are redacted from every request before it is sent (`ctx.egress`, 1B.1); that only covers secrets
the harness knows about, so the rest of what the model sees (your code and prompts) still goes to a cloud provider.
A purely local Ollama binding is not affected by that gate: its `egress.remote`
is `false` for `localhost`/`127.0.0.1`.

## Setup
Needs Node 20.3 or newer, and, for the current local-worker path, Ollama
installed with `qwen2.5-coder:3b-instruct` pulled
(`ollama pull qwen2.5-coder:3b-instruct`).

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
