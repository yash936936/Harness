# Debug log — Coding Harness

> Append-only. Every completed coding task gets an entry here, even "no
> issues found." Newest entries at top.

## DBG-006 — 1.2b OpenAI-compatible provider, rate limiter, egress consent — 2026-09-22
**Task:** Add a cloud provider path (`providers/openai-compatible.ts`), a
shared `RateLimiter`, the egress consent gate and egress log fields, typed
`quota`/`payment`/`consent` errors, and an `egress` declaration on the Ollama
provider (D-021 to D-023).
**Tested:** `tsc --noEmit` clean; 84 tests pass, 3 skipped (2 live Ollama,
1 live OpenRouter). 44 new tests across `test/openai-compatible.test.ts`
(wire format, tool history, config, error classification, key never in the
log, consent gate, limiter integration) and `test/rate-limiter.test.ts`
(window, daily ceiling, failed attempts count, UTC reset, persistence,
concurrency, abort). All 40 earlier tests still pass. I checked the tests
can fail: removing the key scrub, the consent check, the
count-failures rule, and the daily-quota match each broke the expected tests.
**NOT tested:**
- Any real OpenRouter call. The live test exists and spends one request
  (`HARNESS_LIVE_OPENROUTER=1`).
- The 429 quota-versus-congestion split. It matches `per day` / `daily` in
  the error text, a guess from documentation, not from the live API.
- The UTC day-boundary assumption for the daily counter.
- Tool calling through a real OpenAI-compatible model, and thinking-model
  output (think blocks) with tool calls.
- Redaction and the secrets proxy: not built (Phase 1B.1). Until then a
  consenting remote call sends unredacted content.
**Found:** a provider that forgets to declare `egress` would bypass the
consent gate (documented in `code_logic.md`); the mock is meant to be
ungated.
**Fixed:** n/a.

## DBG-005 — 1.3 tool-registry bundle — 2026-09-20
**Task:** Build `ctx.tools` (`src/bundles/tool-registry/`): registration,
listing, validated dispatch, logging, pre/post-execute hooks.
**Tested:** `tsc --noEmit` clean; 15 new tests pass (40 total, 2 skipped).
Covers: separate plugin registers with zero registry edits and unregisters
on dispose; two tools dispatch without cross-calling; duplicate name
rejected and original kept; registration validation (name, description,
actionClass, schema); `list()` usable as model-adapter `ToolSpec[]`;
unknown tool / bad input / throwing tool return `ok:false` without
throwing; non-string output, truncation; `tool.call` logged before
execution; fail-closed on log failure (call not run / result not
returned); pre-execute deny, crashing hook blocks, hooks can't alter the
executing input; post-execute redaction and fail-closed on hook crash.
**NOT tested:** anything through the real agent loop (1.5). Hooks are
exercised only by test listeners; no real policy-gates exist until Phase 5.
**Found:** nothing new (DBG-002 Cordis notes held: await plugin loading,
declare `static inject`).
**Fixed:** n/a. (A duplicate `ajv` line I added to package.json by hand was
spotted on inspection and removed before shipping.)

## DBG-004 — 1.2 live verification against Ollama — 2026-09-20
**Tested (owner's machine, Windows, Ollama + `llama3.2:3b`):** 18/18 in
`test/model-adapter.test.ts` with `HARNESS_LIVE=1`, including the real
uninstalled-model 404 -> `ollama pull` error and a real completion with
non-empty text and output tokens.
**Found:** first live run failed only because vitest's default 5s test
timeout is shorter than a cold model load. The adapter timeout (120s) was
not involved. A 32-token reply took about 26s even on the second run, so
expect slow iterations in the 1.5 loop on this hardware/model.
**Fixed:** live test given a 180s timeout and 170s adapter timeout.
**Not covered:** live tool calling (`tools` in the request) with a real
model; still mock-verified only. First real check comes in 1.5.

## DBG-003 — 1.2 provider switched Anthropic -> Ollama — 2026-09-20
**Task:** Replace the Anthropic provider with an Ollama provider (D-018).
**Tested:** `tsc --noEmit` clean; 25 tests pass, 2 skipped (live). Mocked
HTTP: request/response mapping, tool_calls, tool history (`role:"tool"` +
`tool_name`), 404/400/500/503, network failure, timeout, malformed body.
Real loopback HTTP: a Node `http` server standing in for Ollama (success +
404), and a closed port (real connection refused -> `network` error with
"Is Ollama running?").
**NOT tested:** any real Ollama server or model. The build environment
cannot reach ollama.com or run models, so the wire format (`/api/chat`,
`stream:false`, tool schema, `done_reason`, token counts) follows Ollama's
documented API and is unverified against a live server. Tool calling only
works if the chosen model supports tools; unverified.
**Found:** nothing new; DBG-002 findings still apply.
**Fixed:** n/a. Anthropic provider and its tests removed from the tree.

## DBG-002 — 1.2 model-adapter bundle — 2026-09-20
**Task:** Build `ctx.llm` (`src/bundles/model-adapter/`): provider interface,
Anthropic provider (raw `fetch`), mock provider, session logging at the call site.
**Tested:** `tsc --noEmit` clean; 14 mocked-HTTP/unit tests pass (request
shape, tool-use mapping, HTTP 401/403/429/400/529 -> typed errors, network
failure, timeout, malformed body, duplicate/unknown provider, plug-and-play
mock registered from a separate plugin and unregistered on dispose,
log-before-call ordering, fail-closed on log failure). Live check
(`HARNESS_LIVE=1`): invalid key against real api.anthropic.com -> `LLMError
kind=auth status=401 "API key is invalid"`, logged as `model.error`.
**NOT tested:** a real successful completion (no API key was available in
the build environment). Live test exists, skipped unless `HARNESS_LIVE=1`,
`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` are set. Tool-use request/response
mapping is verified against mocked payloads only, not the live API.
**Found:**
- Cordis plugins load asynchronously; `ctx.llm` is undefined until the
  fiber is awaited (`await ctx.plugin(...)`).
- A service can't read another service (`this.ctx.log`) without declaring
  `static inject = ['log']` ("cannot get property "log" without inject").
- `JSON.stringify(ctx.someService)` throws (circular via `root`); test
  helpers must not serialize services.
**Fixed:** all three (inject declared; tests await fibers; leak check
inspects the provider, not the service).

## DBG-001 — 1.1 session-log bundle — 2026-09-20
**Task:** Build `ctx.log` (`src/bundles/session-log/`) + project scaffold.
**Tested:** `tsc --noEmit` clean; 9 tests pass (also verified by the owner
on Windows: first 7 passed). Two success criteria from `phases.md` were not
covered by the first 7 tests — divergent writes on both fork branches, and
the immutability check — so they were added and pass.
**Found:** Cordis's `.d.ts` files use extensionless imports, so under
`moduleResolution: NodeNext` its types silently degrade (`Service`,
`Context.plugin` reported missing).
**Fixed:** `tsconfig` uses `module: ESNext` + `moduleResolution: Bundler` (D-013).
**Known gap:** no tamper-evidence (hash chain). Append-only by API, not by proof.

## DBG-000 — Docs system scaffolded, no code yet — 2026-09-18
**Task:** Set up `context.md` + full `docs/` system from the uploaded
design draft.
**Tested:** N/A — no code exists yet.
**Found:** N/A.
**Fixed:** N/A.

---
**Next:** Return to [`context.md`](../context.md).
