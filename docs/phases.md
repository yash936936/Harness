# Phases — Coding Harness

> Work through phases and sub-phases in order. Mark a sub-phase done only
> when its files exist, its success criteria are met, and its test is
> logged in `debug.md`. Update `status.md` after each sub-phase, not just
> each phase — sub-phases are the real unit of "a session's work."

## Phase 1 — Kernel skeleton (`profile-minimal`)

### 1.1 — session-log bundle
**Goal:** Append-only event log with replay/fork/resume.
**Files touched:** `src/bundles/session-log/`
**Success criteria:**
- Every write to the log is immutable (no update/delete API exposed).
- A log can be replayed to reconstruct the exact sequence of events.
- A log can be forked at any event index into an independent branch.
**Testing:**
- Unit test: write N events, replay, assert output order/content matches.
- Unit test: fork at event k, write divergent events on each branch, assert
  branches don't cross-contaminate.
- Manual check: attempt to mutate a past event via any exposed method;
  confirm it's rejected or simply not possible via the API surface.
**Status:** Done — 2026-09-20 (see DBG-001)

### 1.2 — model-adapter bundle
**Goal:** `ctx.llm` — first model provider wired in, plug-and-play shape
proven.
**Files touched:** `src/bundles/model-adapter/`
**Success criteria:**
- A `ctx.llm.complete()`-style call returns a real model response.
- Provider/model/host are read from config, not hardcoded. *(Amended
  2026-09-20, D-018: was "API key"; Ollama needs none.)*
- A second (mock) provider can be registered without touching the first
  provider's code — proves the plug-and-play claim, not just one adapter.
**Testing:**
- Integration test: live call to the configured provider, assert a
  non-empty response.
- Unit test: swap provider config to a mock adapter, assert the same
  calling code path works unchanged.
- Failure-mode test: Ollama unreachable or model not installed → clear
  error surfaced, not a silent hang or crash. *(Amended, D-018.)*
**Status:** Done — 2026-09-20. Live test passed on the owner's machine against a real Ollama (`llama3.2:3b`); see DBG-004.

### 1.2b — OpenAI-compatible provider, rate limiter, egress consent
**Goal:** A cloud provider path (OpenRouter first) that is safe to point at
a free tier: limited, classified errors, consent before anything is sent.
Added 2026-09-22 (D-021 to D-023).
**Files touched:** `src/bundles/model-adapter/` (`providers/openai-compatible.ts`,
`rate-limiter.ts`, edits to `index.ts`, `types.ts`, `providers/ollama.ts`)
**Success criteria:**
- `OpenAICompatibleProvider` maps text, tools, tool history and usage to and
  from the OpenAI chat format; model and base URL are required config.
- HTTP 429 is split into `quota` (daily, not retryable) and `rate_limit`
  (retryable, `Retry-After` honored); 402 is `payment`; a 200 response with
  an error body is still an error.
- The `RateLimiter` never exceeds its per-minute window, stops at the daily
  ceiling without calling the provider, counts failed attempts, keeps one
  request in flight by default, and can persist its daily counter.
- A remote provider without `egress: { consent: true }` is refused before
  anything is sent, and the refusal is logged. Allowed calls log the
  destination host and payload size. Loopback needs no consent; LAN counts
  as remote.
- The API key never appears in the session log or in any error message,
  even when a server echoes it back.
**Testing:** `test/openai-compatible.test.ts` and `test/rate-limiter.test.ts`
(mocked HTTP and a fake clock), plus one opt-in live test
(`HARNESS_LIVE_OPENROUTER=1`) that spends a single request.
**Status:** Done — 2026-09-22 (see DBG-006). Live OpenRouter call not yet
run; the 429 wording heuristic is unverified against the real API.

### 1.3 — tool-registry bundle
**Goal:** `ctx.tools` — tools self-register, no central list to maintain.
**Files touched:** `src/bundles/tool-registry/`
**Success criteria:**
- A new tool bundle can register itself on `ctx.tools` with zero edits to
  `tool-registry` itself.
- The registry can enumerate all currently-registered tools at runtime.
- Calling a registered tool by name executes it and returns a result.
**Testing:**
- Unit test: register two dummy tools, list them, call each, assert
  correct dispatch (no cross-calling).
- Regression test: registering a tool with a duplicate name is rejected or
  clearly flagged, not silently overwritten.
**Status:** Done — 2026-09-20 (see DBG-005). Pre/post-execute hooks and required `actionClass` added beyond the listed criteria; see D-019.

### 1.4 — subprocess bundle
**Goal:** `ctx.subprocess` — local execution provider for v1.
**Files touched:** `src/bundles/subprocess/` (`types.ts`, `index.ts`)
**Success criteria:**
- Can run a command in a configured working dir with a configured env
  allowlist. No shell (`spawn(..., { shell: false })`): args are never
  interpolated into a command line, which also keeps a future deny-list
  guardrail (D-006) from being bypassed by shell quoting tricks.
- Env vars outside the allowlist are not visible to the spawned process —
  there is no implicit base set (not even `PATH`); an empty allowlist means
  an empty child environment.
- Command stdout/stderr/exit code are captured and returned to the caller.
  A non-zero exit, a killing signal, a timeout, an aborted call, and a
  command that doesn't exist at all are each a normal `RunResult` field
  (`exitCode`/`signal`/`timedOut`/`aborted`/`spawnError`), never a thrown
  error — mirrors `tool-registry`'s "expected failures come back, not
  throw" choice, since a future tool wrapping this needs those fields to
  hand back to the model.
- Per-stream output cap (`maxOutputBytes`, default 1,000,000) with a
  truncated flag, so a runaway command can't exhaust memory.
- `timeoutMs` and an `AbortSignal` both kill the process and are
  distinguishable in the result (`timedOut` vs `aborted`).
- An `env` value for a key outside every allowlist throws
  `SubprocessError('config')` before anything spawns — fails loud on a
  caller mistake instead of silently dropping the value.
**Testing:** `test/subprocess.test.ts`, all against `process.execPath`
(Node itself) rather than a shell builtin like `echo`, so the suite runs
the same on Windows and Linux without depending on `PATH`/a shell.
- Happy path: stdout capture, stdout/stderr kept separate.
- Security: a parent-env secret is absent from a child dump unless
  allowlisted; an empty allowlist yields an empty child env; per-call env
  values only land for allowlisted keys and win over the parent's; a
  per-call `envAllowlist` is additive to the bundle default, not a
  replacement; an unlisted `env` key throws before spawning.
- Failure modes: non-zero exit and its stderr both surfaced; an unknown
  command resolves with `spawnError` rather than throwing; a killed
  process reports its signal (POSIX only — skipped on Windows, which has
  no real signal delivery).
- Timeout/abort: exceeding `timeoutMs` kills the process and sets
  `timedOut`; an aborted `AbortSignal` kills it and sets `aborted`
  (distinct from `timedOut`); a fast run under a signal that never fires
  completes normally.
- Truncation: output over `maxOutputBytes` is cut to exactly the cap with
  the flag set; output at or under the cap is untouched.
- Working directory: runs in the configured default; a per-call `cwd`
  overrides it.
- Mutation-checked: reverted the env filter to inherit the full parent
  env, skipped the unlisted-key guard, and hardcoded a successful exit
  code — each broke the test meant to catch it.
**Status:** Done and verified on both Linux and Windows, 2026-09-22
(DBG-007, DBG-010). A Windows run initially failed 3 of 5 env-allowlist
tests; root-caused to a Node/Windows platform behavior (Node always injects
11 non-secret baseline env vars when spawning on Windows — D-031, D-032),
not a bug in this bundle. Tests now assert the achievable property (nothing
beyond the allowlist plus that documented, fixed baseline) and re-ran clean
on both platforms. See `src/bundles/subprocess/types.ts`
`WINDOWS_REQUIRED_ENV_VARS`. Not yet exposed as a tool through
`tool-registry` (that wiring, and the `real-fs-write`/`sandbox-write`
action-class question for a shell-out tool, is Phase 5's `policy-gates` and
the agent-loop's tool set, 1.5 — 1.5 itself is done, see below).

### 1.5 — agent-loop bundle
**Goal:** `ctx.agents.loop` — a working ReAct loop over 1.2–1.4.
**Files touched:** `src/bundles/agent-loop/`
**Success criteria:**
- Given a task, the loop reasons, selects a tool, calls it via
  `tool-registry`, observes the result, and repeats until done or
  `max steps` is hit.
- Every reasoning step and tool call is written to the session log (1.1).
- `max steps` and `reflection on/off` config are respected.
- Retry policy follows `LLMError.kind` (D-023): retry `rate_limit`,
  `server`, `network` and `timeout` with backoff and honor `retryAfterMs`;
  never retry `quota`, `payment`, `consent` or `auth`; move to the next
  configured provider or model where a fallback list exists. Every retry is
  one more request against the daily quota.
- Small models often mis-handle native tool calling (see D-018); a
  text-format fallback may be needed, and thinking-model output (think
  blocks) must not break tool-call parsing (D-027).
**Files touched (actual):** `src/bundles/agent-loop/` (`types.ts`,
`index.ts`). Registered as `ctx.agentLoop`, a single top-level service, not
nested under `ctx.agents.*` — `docs/architecture.md`'s `ctx.agents.loop`
label described the capability, not a literal key; there's no orchestrator
yet (Phase 4) to compose multiple agents under one namespace, and nesting
one now would be speculative. If Phase 4 needs that structure it wraps this
service rather than the reverse.
**Testing:** `test/agent-loop.test.ts`, using the existing `MockProvider`
(scripted responses/errors) registered via `ctx.llm.register()`.
- Retry test: a scripted `quota` error is not retried (provider called
  once, run rejects with that error); a scripted `rate_limit` error with
  `retryAfterMs: 750` is retried once, the injected fake sleep is asked for
  exactly `[750]`, and the retried call succeeds. A third test exhausts
  `retry.maxAttempts` on repeated `server` errors and confirms the call
  count is `1 + maxAttempts` before it rejects with the last error.
- Fallback test: a `quota` error on the primary provider (non-retryable)
  moves straight to a configured `fallbackProviders` entry with NO retry
  attempt on the primary first — primary called once, fallback once.
- Integration test: a 2-tool-call task (`read` then `echo`) completes in
  exactly 3 model steps, with the transcript's tool-result blocks matching
  each call's `id` and output.
- A tool whose `execute()` throws surfaces as an `isError: true`
  `tool_result` (via `tool-registry`'s own `execution` handling) and the
  loop continues normally rather than crashing.
- An unregistered tool name passed in `RunTaskOptions.tools` throws
  `AgentLoopError` before any model call (`calls.length === 0`), rather
  than reaching the model with a broken tool list.
- Boundary test: a responder that always returns a tool call is stopped at
  `maxSteps: 3` exactly — `stopReason: 'max_steps'`, `steps: 3`, and the
  provider was called exactly 3 times, not left running.
- Log-completeness test: after a run, `model.request`/`model.response`
  counts match `steps` exactly, `tool.call`/`tool.result` are paired with
  matching tool names and no orphans, and a failed model call logs
  `model.error` (not `model.response`) with the same `LLMError.kind` the
  loop rejected with.
- Reflection tests: with `reflection: true`, a text-only reply triggers
  exactly one "double-check yourself" turn (`steps: 2`, `reflected: true`,
  the injected prompt visible in the second call's messages), never a
  second reflection round even across further text-only replies; with
  reflection off (the default), a text-only reply finishes at `steps: 1`.
- An already-aborted `AbortSignal` stops the run before any model call.
- Constructing with `maxSteps: 0` throws `AgentLoopError`.
- Mutation-checked: skipping the `retryable` check (retrying `quota`
  anyway), loosening the `maxSteps` bound, removing the "reflect at most
  once" guard, and dropping the provider-name override in the retry loop
  each broke the test meant to catch it.
**Status:** Done — 2026-09-22 (see DBG-009). Not yet wired to a real
provider end-to-end (only `MockProvider`); that happens naturally once
1.6 composes `profile-minimal`. Per-binding model ID fallback lists
(D-027, Phase 1B.3 / model-store) are a different mechanism from this
bundle's `fallbackProviders` and aren't built yet — this loop only chooses
between already-configured provider names, it doesn't know about a
binding's own fallback model list.

### 1.6 — `profile-minimal` end-to-end wiring
**Goal:** All of 1.1–1.5 composed into a runnable profile.
No longer gated: D-031's Windows env-allowlist question is resolved (D-032)
and re-verified on both Linux and Windows.
**Files touched:** `src/profiles/profile-minimal.yml`
**Success criteria:**
- `profile-minimal` boots from a single config resolution
  (`cordis.patch.yml`) with no manual wiring steps.
- A single-agent, single-task run completes and the session log alone is
  sufficient to reconstruct what happened (the "model-visible = logged"
  invariant holds end-to-end, not just per-bundle).
**Testing:**
- Smoke test: cold boot → submit one task → task completes → inspect
  session log only (not app state) → confirm the full story is there.
- Regression test: re-run the same task twice, confirm no cross-run state
  leaks (fresh log, fresh agent state each boot unless persistence is
  explicitly configured).
**Status:** Done — 2026-09-24 (see DBG-011). `bootProfileMinimal()`
(`src/profiles/profile-minimal.ts`) composes 1.1-1.5 in dependency order
behind one `ProfileMinimalConfig` call — no separate manual `ctx.plugin()`
sequence for a caller to get wrong. `src/profiles/profile-minimal.yml`
documents the same config shape for humans, but is **not** auto-loaded by
Cordis: real `cordis.patch.yml` resolution needs the optional
`@cordisjs/plugin-loader` + `@cordisjs/plugin-include` peer packages,
which are not installed (D-033) — reopen if a later phase needs the real
loader. 5 tests in `test/profile-minimal.test.ts`: full boot + task
completion; the session log alone reconstructs the run (event order,
gapless seq, response text matches `result.finalText`); a fresh boot has
no cross-run leakage (mutation-checked: a shared-ctx simulation broke 3 of
5); `ctx.subprocess` is live under the profile; an unregistered tool name
still fails before any model call, same as agent-loop alone.

---

## Phase 1B — Cloud access, first run and interface

> Added 2026-09-22 (D-020 to D-029). 1B.1 must be done before the harness
> sends real code to a cloud provider. The rest can follow 1.6.

### 1B.1 — Egress controls
**Goal:** Nothing leaves the machine without consent, and what leaves is
redacted and logged.
**Files touched:** new `src/bundles/egress/` (consent state, redaction,
secrets proxy), edits to `bundle-model-adapter`
**Success criteria:**
- Per-project opt-in and a first-run consent record; a project without
  opt-in sends nothing, whatever the global setting.
- Redaction runs before every send: a seeded fake secret never appears in
  any outbound request body.
- A secrets proxy injects keys at the network boundary; seeded fake keys
  never appear in the session log or in any prompt.
- Endpoint allowlist; every request log entry carries destination and size.
- Cannot be disabled in any profile (D-029).
**Testing:**
- Seeded-secret test over a recording fetch; opt-out test; allowlist test.
**Status:** Done — 2026-09-24 (see DBG-012, D-034). New `bundle-egress`
(`ctx.egress`, `src/bundles/egress/`) owns per-project consent
(`MemoryConsentStore` default, `FileConsentStore` for a persisted
first-run record), an endpoint allowlist, and secret redaction
(`redact`/`redactValue`, applied to every outbound request body and the
`model.request` log entry it produces). `LLMService.static inject` now
requires `'egress'`, and `bootProfileMinimal()` boots it unconditionally
before `model-adapter` — there is no config path that skips it (D-029).
This sits *alongside* the existing D-022 binding flag
(`ModelAdapterConfig.egress.consent`), not in place of it: a remote call
now needs both the binding armed **and** a persisted per-project consent
record, checked independently. 18 new tests (`test/egress.test.ts` unit
tests for the bundle itself; `test/openai-compatible.test.ts`'s new "egress:
project consent, allowlist and redaction (1B.1)" suite for the wiring) —
mutation-checked: bypassing the project-consent check, the allowlist
check, and the redaction call were each tried in turn and each broke
exactly the test written for it. Full suite: 140 passed, 3 skipped (up
from 122/3). **Not built:** the "secrets proxy" as a literal separate
component - the provider API key already never touched
`CompletionRequest`/the session log/any prompt before this phase (D-022's
architecture), so there was no proxy left to build for that specific
case; `redactValue` is the new mechanism for *other* secrets riding along
in message/tool content. `FileConsentStore` is a simple read-modify-write
JSON file - fine for one process, not safe under concurrent writers.
Consent-screen copy and the wizard UI are 1B.2, not this phase.

### 1B.2 — Wizard core, budgets and `doctor`
**Goal:** Headless first-run logic plus a terminal wizard client (D-025).
**Files touched:** new `src/bundles/app-core/`, `src/cli/`
**Success criteria:**
- Provider connection with a connection test (list models, one tiny call,
  latency) and credential storage in the OS credential store, with an
  encrypted-file fallback that warns.
- Consent screen copy from D-020: plain about what the provider receives,
  showing each provider's stated data policy as a claim with its check date.
- Budgets in requests and tokens (per day, session, task soft and hard),
  requests left today shown, hard stop with a report.
- `doctor` shows the active binding, data destinations (model provider and
  any remote sandbox), budget, pinned-model availability, and what still
  works offline.
- With the network off, the harness starts and says what works.
**Testing:** wizard flow tests over the core API; offline-start test;
budget-stop test.
**Status:** In progress — 2026-09-24 (see DBG-013, D-035). Sliced into
pieces, same as 1.2b/1.6/1B.1; this turn built the first piece only.
- **Budgets: done.** New `bundle-app-core` (`ctx.appCore`), `Budgets`
  class (`src/bundles/app-core/budgets.ts`) - requests/tokens at
  task/session/day scope, soft and hard limits, `requestsLeftToday()`,
  and a persisted day counter (mirrors `RateLimiter`'s `statePath`,
  D-023) that survives restart and rolls over at the UTC day boundary.
  `spend()` is all-or-nothing across scopes and throws
  `BudgetExceededError` carrying a full status report - the "hard stop
  with a report" criterion - rather than just the one number that
  tripped it. 15 tests (`test/budgets.test.ts`); mutation-checked twice
  (disabling hard-limit enforcement, and breaking atomicity by mutating
  a scope before all scopes are validated) - each broke multiple tests.
  Not yet wired to anything that actually spends (agent-loop/model-adapter
  don't call `spend()` yet - there is no consumer until the wizard or a
  budget-aware call site exists).
- **Credential storage: done** (see DBG-014, D-036).
  `ctx.appCore.credentials` - `AutoCredentialStore` tries the OS keychain
  (`KeychainCredentialStore`, via `@napi-rs/keyring`: Windows Credential
  Manager / macOS Keychain / Linux Secret Service) first, verified with a
  real round-trip probe (set, read back, compare) before trusting it -
  found by hand that the keychain backend can fail *silently* on read in
  some environments (a headless container here: `getPassword` on a
  missing entry returns `null` with no throw, while `setPassword` throws
  `"Couldn't access platform storage"` - so a broken backend and a
  genuinely-empty one can look identical on a read alone). Falls back
  automatically to `FileCredentialStore` (AES-256-GCM, encrypted at rest,
  tamper-evident via the GCM auth tag) when the probe fails. 14 tests
  (`test/credentials.test.ts`) - the encrypted file store fully
  real-tested (round trip, persistence, tamper detection, no cross-key
  decryption), the fallback *logic* tested with fake stores (including
  one that reproduces the exact silent-failure case found by hand), and
  one environment-tolerant smoke test against the real keychain (must
  either round-trip cleanly or fail as `KeychainUnavailableError` - not
  crash, not any other error). Mutation-checked twice (ignoring the probe
  result and always trusting the primary; swallowing decrypt/tamper
  errors instead of propagating them) - each broke multiple tests. New
  dependency: `@napi-rs/keyring` (prebuilt binaries, `win32-x64-msvc`
  confirmed present - no native build tooling needed on the target
  machine).
- **Consent-screen copy/data: done** (see DBG-015, D-037).
  `ctx.appCore.consentScreen(providerName, egress?)` / `buildConsentScreenData`
  - always returns D-020's general statement (no telemetry of our own;
    local keeps everything on-machine; cloud sends what the model sees
    under that provider's own policy), plus the specific binding's
    destination in plain language, plus that provider's data-policy claim
    *if and only if* one has actually been checked against a real source
    - `lookupProviderPolicy` returns `undefined` for anything not in the
    small curated registry rather than inventing a claim on a provider's
    behalf. Currently sourced: `ollama` (local runtime, nothing leaves via
    Ollama itself) and `openrouter` (paraphrased from
    openrouter.ai/docs/guides/privacy/provider-logging, checked
    2026-09-24 - no prompt/response storage or training by default unless
    logging is opted in, two-boundary structure since the underlying
    routed provider has its own separate policy, account-level Zero Data
    Retention option). 7 tests (`test/consent-copy.test.ts`).
    Mutation-checked twice (fabricating a generic claim for an unknown
    provider; hard-coding "local" regardless of the actual `egress.remote`
    value - the second one is the mutation that matters most, since it
    would make a real cloud call falsely claim nothing left the machine)
    - each broke 2 tests.
- **Provider connection test: done** (see DBG-016, D-038).
  `testProviderConnection` (`src/bundles/app-core/provider-connection.ts`,
  wired onto `ctx.appCore.testConnection`) lists models (best-effort), then
  makes one tiny timed probe call — never throws, returns a structured
  `{ ok, latencyMs, model, models, error }` the wizard can render directly.
  Takes an already-constructed provider rather than a `ctx.llm` name, since
  the point of the test is to decide whether to register the provider at
  all. A remote provider requires `acknowledgeRemote: true`: a narrower,
  one-off gate distinct from `ctx.egress`'s persisted per-project consent
  (D-029), which doesn't exist yet at wizard time (connection test runs
  *before* the consent screen — see 1B.4 below). Added
  `LLMProvider.listModels?()`, implemented for `OllamaProvider`
  (`GET /api/tags`) and `OpenAICompatibleProvider` (`GET /models`). 14 tests
  (`test/provider-connection.test.ts`). Mutation-checked (disabled the
  remote gate — broke the test meant to catch it). A real bug was also
  caught by a test hanging on first run, not by inspection: model listing
  originally had no timeout of its own, so a hung `/models` endpoint would
  have hung the whole test forever; fixed by sharing one deadline across
  both the listing and the probe call.
- **Not started:** `doctor`, the terminal wizard CLI client itself
  (`src/cli/`), offline-start test, budget-stop integration test (the
  budget logic is tested standalone; nothing yet stops a real call using
  it). The connection test above is not yet called from anywhere real —
  that wiring is the CLI client's job.

### 1B.3 — Model store and pinning
**Goal:** Verified, pinned models and clear fallbacks (D-027).
**Files touched:** new `src/bundles/model-store/`
**Success criteria:**
- Records source, revision, SHA-256 and license per local model; refuses a
  digest that does not match its pin; accepts only allowlisted sources.
- Each binding has a pinned model ID and an ordered fallback list.
- Needle version and license file recorded.
**Testing:** digest-mismatch test; unavailable-pinned-model test in `doctor`.
**Status:** Not started

### 1B.4 — Desktop shell
**Goal:** A desktop app over the 1B.2 core, adding no logic of its own.
**Files touched:** new `app/desktop/`
**Success criteria:**
- Electron and Tauri are both measured on the 8 GB machine (installer size,
  cold start, idle memory with the core running) and one is chosen in a
  logged decision before building.
- Screens: provider connection, consent, budget and requests left, the
  `doctor` view, approval prompts for real writes, session and egress log
  viewer, advanced settings for local models.
- Idle memory plus the harness host fits the 8 GB budget.
**Testing:** the same flows as 1B.2 run through the shell.
**Status:** Not started

---

## Phase 2 — Retrieval pipeline

### 2.1 — retrieval-grep bundle
**Goal:** `ctx.retrieval.grep` — cheap filter stage.
**Files touched:** `src/bundles/retrieval-grep/`
**Success criteria:**
- Given a query string and a codebase path, returns candidate file
  matches using ripgrep under the hood.
- Respects configured ripgrep flags (e.g. ignore patterns).
**Testing:**
- Unit test: known string in a fixture repo → returned in results.
- Unit test: string absent from repo → empty result set, no error.
- Config test: an ignore-pattern flag excludes a matching file that would
  otherwise show up.
**Status:** Not started

### 2.2 — retrieval-treesitter bundle
**Goal:** `ctx.retrieval.parse` — structural parse stage.
**Files touched:** `src/bundles/retrieval-treesitter/`
**Success criteria:**
- Given a file, returns a structural parse (functions/classes/symbols) for
  at least one configured language grammar.
- Malformed/unparseable files fail gracefully (skipped with a logged
  reason, not a crash).
**Testing:**
- Unit test: parse a known-good fixture file, assert expected symbols are
  extracted.
- Failure-mode test: feed a syntactically broken file, assert graceful
  skip + log entry, not a pipeline crash.
**Status:** Not started

### 2.3 — embeddings bundle
**Goal:** `ctx.embeddings` — embedding generation. *(Amended 2026-09-22,
D-028: pick the provider first. It must fit free-tier request limits, by
batching or a small local model. 2.5 works BM25-only until this exists.)*
**Files touched:** `src/bundles/embeddings/`
**Success criteria:**
- Given text, returns a vector from the configured provider/model.
- Batches multiple texts in one call where the provider supports it
  (not one API call per chunk).
**Testing:**
- Integration test: embed a known string twice, assert identical (or
  near-identical, provider-dependent) vectors — determinism check.
- Performance check: batch of N texts takes meaningfully fewer calls than
  N individual embed calls.
**Status:** Not started

### 2.4 — vectorstore-lancedb bundle
**Goal:** `ctx.vectorstore` provider `lancedb`.
**Files touched:** `src/bundles/vectorstore-lancedb/`
**Success criteria:**
- Can upsert vectors with metadata and query top-K nearest neighbors.
- Data persists across process restarts at the configured local DB path.
**Testing:**
- Unit test: insert known vectors, query with a vector close to one of
  them, assert it's returned in top-K.
- Persistence test: insert, restart the process, query again, assert data
  survived.
**Status:** Not started

### 2.5 — retrieval-rank bundle
**Goal:** `ctx.retrieval.rank` — hybrid BM25 + embedding ranking over
2.1–2.4. *(Amended 2026-09-22, D-028: ships BM25-only first; the embedding
weight is added once 2.3 and 2.4 exist.)*
**Files touched:** `src/bundles/retrieval-rank/`
**Success criteria:**
- Combines grep/tree-sitter candidates with embedding similarity into a
  single ranked top-K list.
- The BM25-vs-embedding weight is configurable and actually changes
  ranking order on a test query (proves it's wired, not a no-op knob).
**Testing:**
- Integration test: fixed query + fixture repo → assert top-K ordering is
  stable and sane (relevant file ranks above an unrelated one).
- Config test: set weight fully to BM25, then fully to embedding, assert
  the resulting ranking differs between the two settings.
**Status:** Not started

### 2.6 — Retrieval pipeline integration test
**Goal:** Prove classical RAG works end-to-end and is consumable by the
Phase 1 agent loop.
**Files touched:** none new — integration test only.
**Success criteria:**
- A query run through 2.1→2.5 returns top-K context that the Phase 1
  agent loop can accept and use in a real task.
**Testing:**
- End-to-end test: agent loop is given a task requiring codebase context
  it doesn't already have; confirm it retrieves relevant context via this
  pipeline and the task outcome reflects that context (not a hallucinated
  answer).
**Status:** Not started

---

## Phase 3 — Memory + skills

### 3.1 — Episodic memory tier
**Goal:** Task/approach/result/lesson written as a durable session event
at turn end.
**Files touched:** `src/bundles/memory/` (episodic path)
**Success criteria:**
- Every completed turn produces exactly one episodic entry, linked to its
  session-log events.
- Entries are queryable by task/agent/time range.
**Testing:**
- Unit test: run N turns, assert N episodic entries exist with correct
  linkage back to session-log event IDs.
- Query test: filter by a time range and agent ID, assert correct subset
  returned.
**Status:** Not started

### 3.2 — Hot tier
**Goal:** Always-loaded, token-capped tier as an early system-prompt-section
plugin.
**Files touched:** `src/bundles/memory/` (hot path)
**Success criteria:**
- Hot tier content is injected into every agent's system prompt.
- Token cap is enforced — content is trimmed/prioritized, not silently
  allowed to exceed the cap.
**Testing:**
- Unit test: fill hot tier past its cap, assert it's trimmed to fit and
  the run doesn't fail.
- Integration test: a fact placed in hot tier is verifiably visible to the
  model on the very next turn (via a task that requires it).
**Status:** Not started

### 3.3 — Semantic tier
**Goal:** Architecture facts written only when non-trivial to reconstruct
from code.
**Files touched:** `src/bundles/memory/` (semantic path)
**Success criteria:**
- A semantic entry can be written, retrieved by query, and is
  distinguishable from episodic entries (different tier, different
  retention logic).
**Testing:**
- Unit test: write a semantic fact, retrieve it via a query unrelated to
  the exact wording (paraphrase match), assert it's found.
**Status:** Not started

### 3.4 — Compaction job
**Goal:** Scheduled `ctx.jobs` task promoting repeated episodic lessons
into hot rules or procedures.
**Files touched:** `src/bundles/memory/` (compaction path)
**Success criteria:**
- Running compaction on a fixture set with a repeated lesson produces a
  new hot-tier or procedural entry summarizing it.
- Compaction is idempotent — running it twice on the same input doesn't
  duplicate the promoted entry.
**Testing:**
- Integration test: seed 3+ episodic entries with the same recurring
  lesson, run compaction, assert exactly one promoted entry appears.
- Idempotency test: run compaction again immediately, assert no duplicate.
**Status:** Not started

### 3.5 — skills bundle
**Goal:** `ctx.skills` — Agent Skills spec (`SKILL.md`, progressive
disclosure) mapped to the procedural tier.
**Files touched:** `src/bundles/skills/`
**Success criteria:**
- A `SKILL.md` folder's name+description loads by default; full
  instructions load only when the task matches; bundled resources load
  only on demand — all three levels demonstrably different in what's in
  context at each stage.
**Testing:**
- Unit test: inspect context size/content at "default," "task-matched,"
  and "resource-loaded" stages for one skill — confirm they differ as
  specified, not all-or-nothing.
- Integration test: a task matching a skill's description triggers full
  instruction loading; an unrelated task does not.
**Status:** Not started

### 3.6 — Memory system integration test
**Goal:** Prove memory actually improves outcomes across sessions, not
just accumulates.
**Files touched:** none new — integration test only.
**Success criteria:**
- A lesson learned in session A (via a mistake + correction) measurably
  changes behavior in session B without the lesson being restated by the
  user.
**Testing:**
- Two-session test: session A hits a known failure mode and gets
  corrected; compaction runs; session B is given a similar task; assert
  the failure mode does not recur and the relevant hot/procedural entry
  was used (visible in session log).
**Status:** Not started

---

## Phase 4 — Orchestrator + sub-agents

### 4.1 — Planner (orchestrator, planning half)
**Goal:** `ctx.agents.orchestrator` can decompose a task into subtasks.
**Files touched:** `src/bundles/orchestrator/`
**Success criteria:**
- Given a multi-step task, produces an explicit subtask list/plan before
  any execution starts.
- The plan itself is logged (session log) before execution, so it can be
  inspected independent of the outcome.
**Testing:**
- Unit test: feed a known multi-step task, assert the plan contains the
  expected subtask count/shape.
- Log test: confirm the plan appears in the session log prior to the
  first subtask's execution events.
**Status:** Not started

### 4.2 — Executor (orchestrator, execution half)
**Goal:** Executes a plan's subtasks against the agent-loop from Phase 1.
**Files touched:** `src/bundles/orchestrator/`
**Success criteria:**
- Each subtask in a plan is dispatched to an agent-loop instance and its
  result collected.
- A failed subtask is handled per a defined policy (retry / abort / skip),
  not left in an undefined state.
**Testing:**
- Integration test: a 3-subtask plan executes all 3 and aggregates results
  correctly.
- Failure-mode test: force one subtask to fail, assert the configured
  failure policy is actually applied (not silently ignored).
**Status:** Not started

### 4.3 — subagent-scope bundle
**Goal:** `ctx.agents.spawn` — each sub-agent is a scoped `ctx` realm.
**Files touched:** `src/bundles/subagent-scope/`
**Success criteria:**
- A spawned sub-agent only has access to the tools/memory explicitly
  granted to its scope — no implicit access to the parent's or a
  sibling's permissions.
- Scoping is enforced at the `ctx` level, not by convention/trust.
**Testing:**
- Security test: spawn two sub-agents with different tool grants, attempt
  to call an ungranted tool from each, assert both are blocked.
- Isolation test: write to sub-agent A's memory scope, assert sub-agent B
  cannot read it directly (only via explicit sharing, if that exists).
**Status:** Not started

### 4.4 — Multi-agent integration test
**Goal:** Prove the orchestrator + sub-agent scoping works together on a
real task.
**Files touched:** none new — integration test only.
**Success criteria:**
- A task requiring at least two distinctly-scoped sub-agents (e.g. one
  read-only research agent, one code-editing agent) completes correctly,
  with each agent staying inside its scope for the whole run.
**Testing:**
- End-to-end test: run the task, inspect the session log to confirm no
  scope violations occurred and the final result is correct.
**Status:** Not started

### 4.5 — router bundle (Needle)
**Goal:** `ctx.router` — a small local model picks the sub-agent, the
playbook, and read-only or allowlisted tool calls (D-026).
**Files touched:** new `src/bundles/router/`
**Success criteria:**
- Needle version and license are pinned in the model store (1B.3).
- Each decision class it owns beats or matches worker-made decisions on the
  frozen router suite, at lower latency and fewer requests; a class that
  does not stays with the worker.
- Fallback chain is Needle, rules, worker. Deleting the Needle files leaves
  the harness starting normally.
- Requests saved per task are recorded.
**Testing:** frozen router suite per decision class; delete-Needle boot test.
**Status:** Not started

---

## Phase 5 — Sandbox providers + policy gates

### 5.1 — sandbox-crabbox bundle
**Goal:** `ctx.sandbox` provider `crabbox` — leased remote execution.
*(Amended 2026-09-22, D-024: use Crabbox's direct, local-container or
static-SSH modes. Its hosted broker is not available to this project. Pin
the version. Measure the local-container memory cost and the Windows rsync
requirement on the 8 GB machine first. A remote sandbox is a second data
destination: it must show in consent and `doctor`.)*
**Files touched:** `src/bundles/sandbox-crabbox/`
**Success criteria:**
- Can lease a remote environment, run a command in it, and return output.
- Lease is released (not leaked) when the task completes or errors.
**Testing:**
- Integration test: lease → run `echo` → assert output → assert lease
  shows as released afterward (check broker state or equivalent).
- Failure-mode test: broker unreachable → clear error, no hung lease.
**Status:** Not started

### 5.2 — sandbox-cubesandbox bundle
**Goal:** `ctx.sandbox` provider `cubesandbox` — fast VM-isolated
execution.
**Files touched:** `src/bundles/sandbox-cubesandbox/`
**Success criteria:**
- Can boot and run a command via the E2B-compatible API within the
  expected fast-boot time budget.
- Isolation: a command cannot reach the host filesystem outside its
  sandboxed environment.
**Testing:**
- Performance test: measure boot-to-first-output time against the
  provider's claimed budget; flag if it's meaningfully worse.
- Security test: attempt to read a host-only path from inside the
  sandbox, assert it fails.
**Status:** Deferred to Phase 8 (D-024): needs a Linux host with KVM.

### 5.3 — policy-gates: read-only and sandbox-scoped-write rules
**Goal:** First two rows of the policy table enforced.
**Files touched:** `src/bundles/policy-gates/`
**Success criteria:**
- Read-only actions execute with no approval step.
- Sandbox-scoped writes execute autonomously but produce a log entry.
**Testing:**
- Unit test: dispatch a read-only action, assert no approval-pending
  event is created.
- Unit test: dispatch a sandbox-scoped write, assert it executes AND a
  log entry is created.
**Status:** Not started

### 5.4 — policy-gates: real-fs-write + confidence scoring
**Goal:** Third row — approval or confidence-threshold auto-approve.
**Files touched:** `src/bundles/policy-gates/`
**Success criteria:**
- A real-fs-write action's confidence score combines the model's
  self-reported value with at least one independent heuristic (file
  criticality, diff size, or test coverage of the touched path) — never
  the self-reported value alone.
- Above threshold: auto-allowed and logged. Below: held with a logged
  approval-pending event.
**Testing:**
- Unit test: force a low independent-heuristic signal even with a high
  self-reported score, assert the combined score still triggers a hold
  (proves it's not trusting self-report alone).
- Integration test: approve a held action via the approval mechanism,
  assert execution then proceeds and the resolution is logged.
**Status:** Not started

### 5.5 — policy-gates: external-side-effect + deny-list
**Goal:** Fourth and fifth rows — always-approval and hard-block, both
with no threshold override.
**Files touched:** `src/bundles/policy-gates/`
**Success criteria:**
- External side-effecting actions always hold for approval regardless of
  any confidence score.
- Deny-listed actions are rejected outright, including pattern-matched
  variants (wrapped/aliased commands), with no override path.
**Testing:**
- Regression test: even a maximally "confident" external-side-effect
  action still holds for approval — confirms no accidental threshold
  bypass exists for this class.
- Security test: attempt a deny-listed action via a wrapped/aliased form
  (e.g. an alias for `rm -rf`), assert it's still blocked by pattern match.
**Status:** Not started

### 5.6 — Full guardrail integration test
**Goal:** All five action classes verified together, plus profile-level
enforcement.
**Files touched:** none new — integration test only.
**Success criteria:**
- A single test run exercises all five action classes and each resolves
  per the policy table.
- `profile-coding` cannot boot with `policy-gates` disabled (a
  profile-level check, not a runtime toggle).
- `profile-coding` is complete at the end of this sub-phase.
**Testing:**
- End-to-end test: scripted run hitting all 5 classes in one session,
  assert every gate decision appears correctly in the session log.
- Config test: attempt to boot `profile-coding` with policy-gates
  disabled, assert boot fails or is rejected.
**Status:** Not started

---

## Phase 6 — Eval harness

### 6.1 — eval-runner core
**Goal:** `ctx.eval` — score a completed run from the session log.
**Files touched:** `src/bundles/eval-runner/`
**Success criteria:**
- Given a completed session log and a scoring function, produces a
  pass/fail (or numeric) result.
- Works purely from the session log — no dependency on live agent state.
**Testing:**
- Unit test: feed a known-good fixture log through a simple scoring
  function, assert expected result.
- Determinism test: run the same log through the same scorer twice,
  assert identical output.
**Status:** Not started

### 6.2 — Scoring functions + thresholds
**Goal:** At least one real scoring function per task type this project
cares about (e.g. "did the code change compile/pass tests").
**Files touched:** `src/bundles/eval-runner/` (scorers)
**Success criteria:**
- A scorer correctly distinguishes a genuinely good run from a genuinely
  bad one on real (not synthetic) fixture data.
**Testing:**
- Calibration test: run the scorer against a hand-labeled set of known
  good/bad runs, assert it agrees with the labels above an acceptable
  error rate.
**Status:** Not started

### 6.3 — eval-langfuse bundle
**Goal:** `ctx.eval.export` — optional export to Langfuse.
**Files touched:** `src/bundles/eval-langfuse/`
**Success criteria:**
- A scored run can be exported to a configured Langfuse project and shows
  up there with matching trace/score data.
**Testing:**
- Integration test: export a run, query Langfuse's API/UI, confirm the
  data matches what was sent.
- Failure-mode test: Langfuse unreachable — export fails gracefully
  without blocking the underlying eval-runner result.
**Status:** Deferred to Phase 8 (D-024): self-hosting needs Postgres,
ClickHouse, Redis and S3, and Langfuse Cloud sends traces off the machine.

### 6.4 — Eval harness integration test
**Goal:** Prove eval consumes real Phase 1–5 output correctly.
**Files touched:** none new — integration test only.
**Success criteria:**
- A run through the actual `profile-coding` stack (not a synthetic
  fixture) produces a correct eval score end-to-end.
**Testing:**
- End-to-end test: run a real task through the full stack, score it,
  manually verify the score matches a human judgment of the run's quality.
**Status:** Not started

---

## Phase 7 — Browser tool (`profile-research`)

### 7.1 — browser bundle wiring
**Goal:** `ctx.browser` via `vercel-labs/agent-browser`.
**Files touched:** `src/bundles/browser/`, `src/profiles/profile-research.yml`
**Success criteria:**
- A sub-agent can issue a browse/fetch action and get back page content.
- MCP profile (core/network/state/allowed-domains) config is respected.
**Testing:**
- Integration test: fetch a known test page, assert expected content
  returned.
- Config test: change the MCP profile, confirm behavior changes
  accordingly (e.g. network access toggled off blocks fetches).
**Status:** Not started

### 7.2 — Input guardrails for browser content (Layer 1)
**Goal:** Content-boundary markers + prompt-injection pattern check applied
to every fetched page.
**Files touched:** `src/bundles/browser/`, hook into `agent/pre-step`
**Success criteria:**
- Fetched content is wrapped in explicit boundary markers before reaching
  the model — verifiable by inspecting what's actually in the prompt.
- A page containing an embedded instruction-like string ("ignore previous
  instructions") is flagged for policy-gate visibility.
**Testing:**
- Unit test: fetch a fixture page with known injection-style text, assert
  it's flagged and boundary-wrapped, not passed through raw.
- Regression test: fetch a clean page, assert no false-positive flag.
**Status:** Not started

### 7.3 — Output guardrails: domain allowlist + egress (Layer 3)
**Goal:** `--allowed-domains` enforced; expanding it is itself gated;
secrets never leak into fetched-content logs.
**Files touched:** `src/bundles/browser/`, `src/bundles/policy-gates/`
**Success criteria:**
- A fetch to a non-allowlisted domain is blocked by default.
- Expanding the allowlist requires going through the policy-gate approval
  path, same as any other gated action.
- Post-hoc scan catches an accidentally-leaked secret in fetched output
  before it's surfaced.
**Testing:**
- Security test: attempt a fetch to a disallowed domain, assert blocked.
- Approval-flow test: request an allowlist expansion, assert it surfaces
  as a policy-gated approval, not a silent config edit.
- Leak test: seed a fixture page/response containing a fake secret
  pattern, assert the post-hoc scan catches and redacts/flags it.
**Status:** Not started

### 7.4 — Research task integration test
**Goal:** Prove the full browser + guardrail stack works on a real task.
**Files touched:** none new — integration test only.
**Success criteria:**
- A sub-agent completes a real external research task end-to-end, with
  every fetch logged, boundary-marked, and domain-checked.
**Testing:**
- End-to-end test: run a research task requiring 2+ fetches across
  different domains (one allowed, one not), confirm correct
  allow/block behavior and full session-log coverage.
**Status:** Not started

---

## Phase 8 — Multi-user scale (`profile-full`)

### 8.1 — vectorstore-qdrant bundle
**Goal:** `ctx.vectorstore` provider `qdrant`, swappable with LanceDB.
**Files touched:** `src/bundles/vectorstore-qdrant/`
**Success criteria:**
- Same upsert/query interface as `vectorstore-lancedb` (2.4) — swapping
  providers requires only a config change, no calling-code change.
- Handles concurrent writes from multiple sessions without corruption.
**Testing:**
- Interface-parity test: run the same test suite from 2.4 against Qdrant,
  assert equivalent pass results.
- Concurrency test: fire concurrent upserts from simulated multiple
  sessions, assert no data loss/corruption.
**Status:** Not started

### 8.2 — CubeSandbox as second concurrent provider
**Goal:** `profile-full` runs crabbox and CubeSandbox side by side.
**Files touched:** `src/profiles/profile-full.yml`
**Success criteria:**
- Two sandbox requests routed to different providers in the same run
  complete independently without interfering with each other.
**Testing:**
- Integration test: dispatch one task to each provider concurrently,
  assert both complete correctly and neither blocks the other.
**Status:** Not started

### 8.3 — eval-langfuse enabled by default
**Goal:** `profile-full` exports every eval run to Langfuse without extra
config per run.
**Files touched:** `src/profiles/profile-full.yml`
**Success criteria:**
- Every run under `profile-full` produces a corresponding Langfuse trace
  with no per-run opt-in required.
**Testing:**
- Smoke test: run a task under `profile-full`, confirm a matching
  Langfuse trace appears without manual export steps.
**Status:** Not started

### 8.4 — Multi-user load test
**Goal:** Prove `profile-full` actually holds up under concurrent users,
not just concurrent bundles.
**Files touched:** none new — integration test only.
**Success criteria:**
- N simulated concurrent users, each running independent tasks, complete
  correctly with no cross-user data leakage (memory, sandbox, or
  vectorstore) and no unacceptable latency degradation.
**Testing:**
- Load test: simulate N concurrent sessions (define N based on realistic
  expected usage — open, confirm with user before running), assert
  correctness and capture latency/error-rate numbers as a baseline.
- Isolation test: confirm no session can read another session's memory,
  sandbox output, or vector data.
**Status:** Not started

---
**Next:** Return to [`context.md`](../context.md).
