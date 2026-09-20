# Debug log — Coding Harness

> Append-only. Every completed coding task gets an entry here, even "no
> issues found." Newest entries at top.

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
