# Coding Harness

A TypeScript multi-agent coding harness built on Cordis. Bundles provide model access, tools, retrieval, memory, sandbox providers, policy gates and evaluation; profiles compose them into runnable stacks. This repository is a working prototype, not the complete multi-user desktop product.

## Current status (2026-11-13)

**Implemented and CI-tested:** the governed `npm run harness -- code` path, terminal approvals, file-tool policy gates, Ollama/OpenRouter adapters, session logging, cross-process file locking and bounded semantic-memory retrieval. Main is `9ddfdd94710b3c05c593dc93228e18a810c2f5aa`; PR #85's post-merge CI run #541 passed all seven jobs on Ubuntu and Windows.

**Held or not yet accepted:** S0 / ARCH-01 is on permanent hold under D-110. The governed CLI must not probe Docker, WSL, or Crabbox and does not offer command execution or host fallback. S1 is deferred; full S4 command/test acceptance is blocked under D-112. S6 still needs genuine owner-labelled sessions. S7 still needs focused live embedding and 3B poisoning checks. S5 distribution work and Phases 7/8 are out of scope under D-115. A green CI run does not close these external gates.

**Experimental or deferred:** CubeSandbox, Needle router evaluation/ownership, full desktop UI and sidecar, Qdrant, Langfuse, browser tool and multi-user support. See `docs/status.md`, `docs/AUDIT-CLOSEOUT.md`, and `docs/BUILD-PLAN.md` for current evidence and owner actions.

The per-phase notes below are historical implementation notes, not proof of current acceptance. docs/status.md and docs/AUDIT-CLOSEOUT.md are authoritative. Phase 1 (the profile-minimal kernel):

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

Things to know before relying on Phase 3: `Memory.runTurn()` records one episode per completed or failed turn. In `profile-coding`, templated lessons are derived from the turn log by default; callers can also supply an explicit lesson. Automatic compaction is not scheduled unless `compaction.everyTurns` is configured. Promoted lessons and loaded skills become system-prompt text, so poisoning resistance still needs real-model acceptance. The current `profile-coding` always loads episodic/hot memory and the governed retrieval stack. Skills are optional and load only when `skills.dirs` is configured. Semantic memory is optional and loads only when both an embedding provider and vector store are configured. Scripted tests prove wiring, not model behavior.

Not done: a verified real Crabbox sandbox lease/run/release (5.1), real model-driven end-to-end coding acceptance through `harness code`, labelled real-run calibration (Phase 6.2/6.4), real retrieval/poisoning acceptance, the Langfuse export (deferred), the browser, multi-user scale, and a production desktop client. Concurrent processes sharing one data directory are now locked (the session log and the memory stores), but this is advisory, local-filesystem only, and tested here on Linux and Windows with a handful of processes. See `docs/phases.md` and `docs/status.md`.

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


## Audit acceptance status (2026-11-05)

The repository includes sandbox-provider adapters, router hooks, semantic-memory storage, cross-process file locking, and a real-log calibration script. These are implementation capabilities, not proof of live provider operation or real-model quality. The current outstanding checks are documented in `docs/status.md`: target-host Crabbox doctor and lease smoke, at least 20 independently labelled real agent runs, real Needle-versus-worker comparison and shadow traffic, torn-tail repair before append, lock stress on supported filesystems, a real-model retrieval quality/poisoning evidence, one live OpenRouter call, and Tauri/1B.4 measurements. A bounded agent-facing semantic-memory tool is now implemented and covered by tests, subject to CI. Do not describe those gates as complete until their raw evidence is recorded.

## Known gaps (2026-11-06 review, D-106)

- `npm run harness -- run` is a single model call with no tools, policy gates or sandbox. The governed multi-agent path (`profile-coding`) is reached only from scripts and tests.
- A passing `npm test` does not mean Docker or crabbox ran: all sandbox tests use fakes. On a machine with Docker running and `crabbox` on PATH, run `npm run test:real-sandbox`; until its output is recorded, Phase 5.1 is open.
- There is no desktop UI yet; `app/desktop/` holds only the Electron/Tauri benchmark apps.

## Current closeout state (2026-11-08)

S0 / ARCH-01 is currently PENDING-ENVIRONMENT. The pinned Crabbox image warms and inspect succeeds, but crabbox run fails before the in-box command while creating the private WSL SSH transport file. The latest stop operation succeeded. This does not pass real sandbox acceptance. The owner has asked to pause this one transport issue and continue independent work. See [the incident report](evidence/S0-ARCH-01-TRANSPORT-INCIDENT-REPORT-2026-11-08.md), [status](status.md), and [audit closeout](AUDIT-CLOSEOUT.md).

S1 real orphan recovery remains dependent on S0. S3 manual terminal approval evidence is still required. S5 licensing/provenance, S6 genuine-session evaluation, and S7 real embedding/poisoning acceptance remain incomplete until their own evidence is recorded. The desktop UI remains deferred; benchmark hello-worlds are not a desktop product. Do not infer any of these gates from a passing unit suite.
