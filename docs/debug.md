# Debug log — Coding Harness

> Append-only. Every completed coding task gets an entry here, even "no
> issues found." Newest entries at top.

## DBG-009 — 1.5 agent-loop bundle — 2026-09-22
**Task:** Add `ctx.agentLoop`: a ReAct loop over `ctx.llm` and `ctx.tools`
with the D-023 retry/fallback policy, bounded reflection, and `maxSteps`.
Built alongside D-031 (still open) rather than blocked on it, at the
owner's instruction, to run both in parallel.
**Tested:** `tsc --noEmit` clean; 116 tests pass, 3 skipped (unchanged
pre-existing live-provider tests). 15 new tests in
`test/agent-loop.test.ts`, using the existing `MockProvider` (no new mock
infrastructure needed): 2-tool-call integration, a throwing tool
surfacing as `isError` instead of crashing, an unregistered tool name
failing before any model call, the `maxSteps` boundary with a
never-stopping responder, quota-not-retried, rate_limit-retried-once
honoring `retryAfterMs` via an injected fake sleep, retry exhaustion after
`maxAttempts`, provider fallback with zero retries on the failed primary,
an already-aborted signal stopping the run before any call, construction
rejecting `maxSteps < 1`, reflection firing exactly once and never twice,
reflection off by default, and log-completeness (counts match, tool
call/result pairs matched by name, a failed call logs `model.error` not
`model.response`).
I checked the tests can fail: skipped the `retryable` check (quota got
retried) — broke 3 tests; loosened the `maxSteps` bound — broke 1; removed
the "reflect once" guard — broke 2; dropped the per-provider override in
the retry loop (fallback silently kept hitting the same provider) — broke
1. All reverted after confirming the catch.
**NOT tested:**
- Any real provider end-to-end — only `MockProvider`. Real tool-calling
  quirks (native tool-call parsing edge cases, thinking-model output per
  D-027) aren't exercised here; that's `openai-compatible.test.ts`'s job
  for the wire format, and this bundle just consumes whatever
  `CompletionResponse` it gets.
- Concurrent tool calls in one model turn beyond two, or very large
  transcripts (context growth / truncation isn't this bundle's job yet).
- Real (non-injected) `setTimeout`-based `sleep` under an actual multi-hundred-ms
  delay — only the injected fake-clock path is tested, consistent with how
  `rate-limiter.test.ts` handles the same kind of timing code.
**Found:** none new. Confirms D-031 is unaffected by this work — 1.5 uses
`MockProvider` exclusively, never `ctx.subprocess`, so it doesn't depend on
the env-allowlist question at all.
**Fixed:** n/a.

## DBG-008 — Windows env-allowlist leak found by owner's test run — 2026-09-22
**Task:** none (this is a bug report from the owner running DBG-007's work
on their own Windows machine), plus a same-day fix to the one thing that
was clearly a bug in our control: a weak test assertion.
**What the owner's run showed:** `npx vitest run` on Windows: 98 passed, 3
failed, 3 pre-existing skipped. All 3 failures were in
`subprocess: env allowlist (security)`:
- "a secret set in the parent env is invisible..." — child env had 12 keys
  instead of the expected 1; the 11 extras were PATH, USERNAME, TEMP,
  HOMEDRIVE, HOMEPATH, LOGONSERVER, SYSTEMDRIVE, SYSTEMROOT, USERDOMAIN,
  USERPROFILE, WINDIR.
- "with an empty allowlist the child sees no environment at all" — same 11
  vars appeared with a fully empty allowlist.
- "a per-call envAllowlist entry is additive..." — same 11 vars again.
**Found, and it matters:** the actual named secret (`HARNESS_TEST_SECRET`
/ `sk-super-secret-value`) was NOT among the leaked vars — the
`not.toContain` assertions for that passed. So this run didn't leak
anything sensitive by name. But a 4th test ("per-call env values only
reach the child...") passed on the same run despite presumably the same
underlying leak, and on inspection it only read back one variable
(`process.env.HARNESS_TEST_OVERRIDE ?? ''`) instead of dumping the whole
child environment — a real gap in the test, not evidence the leak didn't
happen there too. That's a bug I introduced when writing 1.4's tests.
**Fixed:** that one test now dumps and checks the full child environment
like the others (`toEqual({ HARNESS_TEST_OVERRIDE: 'from-call' })` against
the whole parsed object), closing the gap so a leak can't hide behind it.
**NOT fixed, and not claimed to be:** the actual leak. I have no Windows
machine to test on. Wrote `scripts/diagnose-windows-env.cjs` — a
standalone script with no dependency on this project's code — that calls
Node's raw `child_process.spawnSync` with `env: {}`, `env: { ONE: '1' }`,
and `env: undefined`, and prints exactly what the child sees for each. Ran
it in this Linux sandbox: all three behaved correctly (0 vars, 1 var, and
full inherit respectively) — confirming the *design* is sound where it's
verifiable here, and that whatever is adding vars back in on the owner's
Windows machine isn't something visible from Linux. Logged as D-031: 1.4's
status is downgraded from unqualified "Done" to "Done on Linux, unverified
on Windows" until the owner runs the diagnostic script and reports the
output, which will show whether this is a Node/Windows platform behavior
needing a code workaround, or specific to that machine's Node install,
antivirus, or shell.
**Next:** owner runs `node scripts/diagnose-windows-env.cjs` on the
Windows machine and pastes the output.

## DBG-007 — 1.4 subprocess bundle — 2026-09-22
**Task:** Add `ctx.subprocess`: run a command with no shell and no implicit
env, capture stdout/stderr/exit code, and surface every failure mode
(non-zero exit, signal, timeout, abort, command-not-found) as a result
field rather than a thrown error.
**Tested:** `tsc --noEmit` clean; 101 tests pass, 3 skipped (all
pre-existing live-provider tests, unrelated to this bundle). 17 new tests
in `test/subprocess.test.ts`: happy path, env-allowlist security (secret
absence, empty-allowlist empty-env, per-call override precedence, additive
per-call allowlist, unlisted-key throws), failure modes (non-zero exit +
stderr, unknown command, killed-by-signal), timeout, abort, output
truncation, and working-directory (default and per-call override). Every
test runs against `process.execPath` rather than a shell builtin, so the
suite is identical on Windows and Linux.
I checked the tests can fail: reverting the env filter to spread
`process.env` broke 3 security tests; skipping the unlisted-env-key guard
broke 1; hardcoding a successful exit code in the `close` handler broke 3
(non-zero exit, killed-by-signal, timeout).
**NOT tested:**
- Actually running on Windows. All of the above ran only in this Linux
  sandbox; the signal test is guarded to skip on `win32` because Windows
  has no real POSIX signal delivery, but the rest should still be run on
  the owner's machine to confirm (`npx vitest run test/subprocess.test.ts`).
- No tool wraps this yet, so it has not been exercised through
  `tools/pre-execute` or a real agent-loop call.
- Very large output (multi-hundred-MB) under `maxOutputBytes` truncation —
  only tested at small (100-byte) caps.
- Concurrent `run()` calls against the same `Subprocess` instance (nothing
  in the implementation should conflict, since each call owns its own
  `child`, but this wasn't specifically tested).
**Found:** while editing `docs/phases.md`, a Python script mistake
(`open(path, 'w')` called a second time after the file was already written
correctly) truncated the file to zero bytes. Caught immediately via
`wc -l` before it was committed; restored with `git checkout -- docs/phases.md`
and the edit redone correctly. No file was lost, but noting it here since
the debug log is supposed to catch exactly this kind of near-miss.
**Fixed:** n/a (subprocess itself); the `phases.md` truncation was
caught and reverted before it went anywhere.

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
