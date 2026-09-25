# Debug log — Coding Harness

> Append-only. Every completed coding task gets an entry here, even "no
> issues found." Newest entries at top.

## DBG-014 — 1B.2 (slice 2): credential storage — 2026-09-24
**Task:** OS credential store + encrypted-file fallback for provider API
keys and other secrets the wizard/consent flow will need to hold.
**Investigated first, before writing any code:** installed
`@napi-rs/keyring` for real in this container and probed its actual
behavior rather than assuming from docs. Findings: `new Entry(service,
account)` never throws at construction, even with a nonsense service
name. `getPassword()` on a key that was never set returns `null`
cleanly - no throw. `setPassword()` in this container (no live
secret-service session, `dbus-daemon` binary present but no session bus
running) throws `Error: Couldn't access platform storage: AccessDenied`.
`deletePassword()` on a nonexistent key does not throw. This directly
shaped the design: a plain try/catch around each call would let a broken
backend look identical to "nothing stored yet" on a `get()`, which is
the worst place for that ambiguity to hide.
**Built:** `src/bundles/app-core/credentials.ts` -
`CredentialStore` interface; `KeychainCredentialStore` (thin wrapper,
lazy/memoized dynamic `import('@napi-rs/keyring')` so an unsupported
platform fails on first use, not at module load); `FileCredentialStore`
(AES-256-GCM, random 32-byte key in a sibling `.key` file created on
first write, atomic write via temp-file-then-rename for the data file);
`AutoCredentialStore` (round-trip probe against the primary before
trusting it, cached for the instance's lifetime, falls back to the file
store otherwise). Wired into `AppCore` as `ctx.appCore.credentials`
(`index.ts`), defaulting to keychain service `'harness'` and file path
`.harness/credentials.json`, both overridable, or a store can be injected
directly.
**Tested:** `tsc --noEmit` clean. `test/credentials.test.ts`, 14 tests:
`FileCredentialStore` - round trip, missing key is `undefined`, multiple
keys coexist, delete works and deleting an absent key is a no-op,
persists across a fresh instance on the same path, key file is exactly 32
bytes, stored values are never plaintext in the data file, a tampered
ciphertext byte fails to decrypt (GCM auth tag) rather than returning
garbage, and two stores with swapped data files (wrong key for the
ciphertext) both fail to decrypt. `AutoCredentialStore` - tested against
fake `CredentialStore` doubles, not the real keychain: uses the primary
once its probe succeeds; falls back when the primary throws; falls back
when the primary *silently* fails (accepts the write, `get()` always
returns nothing - the exact real-world case found by hand above); probes
at most once across many calls (call-count assertion on the fake); the
probe key itself never shows up as a real credential afterward.
`KeychainCredentialStore` gets one environment-tolerant smoke test: must
either round-trip a probe value or throw exactly
`KeychainUnavailableError` - in this container it took the second branch,
confirming the real failure path actually gets exercised, not just
mocked. Full suite: 169 passed, 3 skipped (up from 155/3 - 14 new tests,
zero regressions).
**Mutation-checked:** two separate mutations, each reverted before the
next: (1) `AutoCredentialStore.probe()` made to always return `this
.primary` regardless of the round-trip result - broke the
silent-failure fallback test specifically (the one modeling the real
bug this design exists to catch); the `AlwaysThrowsStore` fallback test
still passed on its own, since that path throws before reaching the
mutated line - expected, confirms each test is pinned to a distinct
failure mode rather than one test accidentally covering for another. (2)
`FileCredentialStore.get()` made to swallow decrypt errors and return an
empty string instead of propagating - broke both tamper-detection tests
(flipped-byte ciphertext, swapped-key-file cross-decryption), which had
been asserting a rejection.
**Found:** none beyond the keychain silent-failure behavior itself,
which is the reason this bundle exists in its current shape rather than
a bug in what was built.
**Fixed:** n/a - new capability.
**New dependency:** `@napi-rs/keyring` `^2.1.0` - checked
`node_modules/@napi-rs/keyring/package.json`'s `optionalDependencies`
before adding; `@napi-rs/keyring-win32-x64-msvc` is listed, confirming a
prebuilt binary exists for the target Windows machine (no native build
step required).

---

## DBG-013 — 1B.2 (slice 1): budgets — 2026-09-24
**Task:** Build the budgets piece of 1B.2 - requests/tokens at
task/session/day scope, soft+hard limits, "requests left today", hard
stop with a report.
**Built:** `src/bundles/app-core/budgets.ts` (`Budgets`,
`BudgetExceededError`, `BudgetStatus`/`ScopeStatus`/`SpendResult` types),
`src/bundles/app-core/index.ts` (`AppCore` Service, `ctx.appCore.budgets`).
`Budgets` is a plain class (no Cordis dependency), same pattern as
`RateLimiter` - testable directly with `new Budgets(config)`, no `ctx`
needed.
**Tested:** `tsc --noEmit` clean. `test/budgets.test.ts`, 15 tests: no
limits configured never throws; hard limit blocks and records nothing;
the thrown error names the specific scope and carries every scope's
status, not just the one that tripped; task checked before session
before day, and a rejection blocks the whole spend atomically (session
not partially incremented when task is what actually failed); negative
amounts rejected; soft-limit flag flips at the threshold without
blocking; `newlySoftBreached` fires once, on the call that crosses it,
not on every call after; `requestsLeftToday()` counts down and floors at
0; `resetTask`/`resetSession` each clear only their own scope; day rolls
over automatically at the UTC boundary while task/session (caller-managed)
are untouched; the day counter survives a fresh `Budgets` instance on the
same day (persistence) and is correctly ignored (starts at 0) on a new
day; a corrupt state file doesn't crash construction. Full suite: 155
passed, 3 skipped (up from 140/3 - 15 new tests, zero regressions).
**Mutation-checked:** two separate mutations, each reverted before the
next: (1) removed the hard-limit check from the validation loop entirely
- broke 3 tests, including the previously-passing "rejects a spend" case
now succeeding with the wrong (unblocked) result; (2) moved the `task`
scope's increment to happen *inside* the per-scope validation loop,
before session/day are checked (breaking atomicity) - broke 5 tests,
including day-rollover and reset tests whose assertions depend on
counters only changing via a fully-validated `spend()`. Reverted;
confirmed clean both times.
**Found:** none.
**Fixed:** n/a - new capability.
**Explicitly not done this slice (see D-035, `docs/phases.md` 1B.2):**
nothing calls `Budgets.spend()` yet; credential storage, consent-screen
copy, provider connection test, `doctor`, and the terminal wizard CLI are
all still open.

---

## DBG-012 — 1B.1 egress controls — 2026-09-24
**Task:** Build `bundle-egress`: per-project consent, endpoint allowlist,
redaction, wired so it cannot be skipped in any profile.
**Built:** `src/bundles/egress/types.ts` (`ConsentRecord`, `ConsentStore`,
`EgressError`), `src/bundles/egress/store.ts` (`MemoryConsentStore`,
`FileConsentStore`), `src/bundles/egress/index.ts` (`EgressPolicy`
service: `hasConsent`/`grantConsent`/`revokeConsent`,
`isAllowedHost`/`assertAllowedHost`, `redact`/`redactValue`). Edited
`src/bundles/model-adapter/index.ts`: `LLMService.static inject` now
includes `'egress'`; `complete()` checks project consent and the
allowlist (remote calls only) before the existing D-022 binding-flag
check's effect, and runs `ctx.egress.redactValue()` on the request body
before it is logged or sent. Edited `src/profiles/profile-minimal.ts`:
`ProfileMinimalConfig.projectId` is now required, `bundle-egress` boots
unconditionally before `model-adapter`.
**Tested:** `tsc --noEmit` clean. New `test/egress.test.ts` (13 tests):
both consent stores (including a real cross-instance persistence check for
`FileConsentStore` via a temp dir), `EgressPolicy` requiring `projectId`,
consent tracked per-project (two policies sharing one store don't leak
consent to each other), allowlist exact-match, and redaction (`redact`,
`registerSecret` on an already-booted policy, `redactValue` over nested
objects/arrays, a secret appearing twice in one string). New "egress:
project consent, allowlist and redaction (1B.1)" suite appended to
`test/openai-compatible.test.ts` (5 tests): binding flag alone is
insufficient without project consent; project consent alone is
insufficient without an allowlisted host; all three together succeed; a
seeded fake secret in message content is absent from both the outbound
HTTP body and the session log, replaced by `[redacted:name]` in both; the
provider's own API key still never appears in the log (re-asserts the
pre-existing D-022 property still holds with redaction added on top).
Updated the 4 existing files that boot `LLMService`
(`test/model-adapter.test.ts`, `test/agent-loop.test.ts`,
`test/openai-compatible.test.ts`'s shared `boot()`, plus one standalone
`ctx` in that file) to also boot `EgressPolicy` — a structural consequence
of the new required inject, not a behavior change for any of those cases
(all loopback, or pre-granted consent so the pre-existing D-022 assertions
keep testing exactly what they tested before). Full suite: 140 passed, 3
skipped (up from 122/3 - 18 new tests, zero regressions).
**Mutation-checked:** three separate mutations, each reverted before the
next: (1) hard-coded `projectConsented = true`, bypassing the store read
- broke the "no project consent" test with the actual success response
where a `consent`-kind error was expected; (2) emptied the
`assertAllowedHost` try block - broke the "host not allowlisted" test the
same way; (3) used the unredacted `rest` instead of `redactValue(rest)` -
broke the seeded-secret test, with the raw secret showing up in the
captured fetch body. Each mutation broke exactly the test built to catch
it and nothing else; confirmed clean after each revert.
**Found:** none beyond what's logged in D-034's "known limitations."
**Fixed:** n/a - new capability, not a bugfix.

---

## DBG-011 — 1.6 `profile-minimal` end-to-end wiring — 2026-09-24
**Task:** Compose 1.1-1.5 (session-log, model-adapter, tool-registry,
subprocess, agent-loop) into a runnable `profile-minimal` stack.
**What I found first:** the design draft's "resolved at boot via
`cordis.patch.yml`" isn't actually available — checked
`node_modules/cordis/package.json` directly; the real YAML loader is
`@cordisjs/plugin-loader` + `@cordisjs/plugin-include`, both optional peer
deps, neither installed. Logged as D-033 rather than silently adding a new
dependency or silently ignoring the gap.
**Built:** `src/profiles/profile-minimal.ts` (`bootProfileMinimal()` — one
config object, five `ctx.plugin()` calls in dependency order, returns the
live `Context`), `src/profiles/profile-minimal.yml` (config-shape
reference, explicitly documented as not auto-loaded).
**Tested:** `tsc --noEmit` clean. `test/profile-minimal.test.ts`, 5 tests:
boots from one call and `ctx.log`/`ctx.llm`/`ctx.tools`/`ctx.subprocess`/
`ctx.agentLoop` are all live; a completed run's session log alone shows
`model.request` before `model.response` with gapless `seq` and the logged
response text matching `result.finalText` (the "model-visible = logged"
invariant, checked end-to-end not per-bundle); a fresh `bootProfileMinimal()`
call has no cross-run leakage (new session id, no provider registrations
carried over); `ctx.subprocess.run()` works under the composed profile; an
unregistered tool name still fails before any model call reaches the log.
Full suite: 122 passed, 3 skipped (up from 117/3 - the 5 new tests, no
regressions).
**Mutation-checked:** made `bootProfileMinimal()` return a cached, shared
`Context` across calls (simulating cross-boot state leakage) - broke 3 of
the 5 tests (`provider "mock" is already registered` on the second boot,
in both the leakage test and the unrelated tool-name test that also
registers a fresh mock). Reverted; confirmed clean.
**Found:** none beyond the `cordis.patch.yml` gap above.
**Fixed:** n/a beyond D-033's resolution (build the composer directly
rather than block on a loader package the project doesn't depend on).

## DBG-010 — D-031 resolved: Windows env baseline root-caused — 2026-09-22
**Task:** Root-cause the 3 failing Windows security tests from DBG-008,
using the diagnostic script and the data the owner reported.
**What the diagnostic showed (owner's machine, Node v22.18.0, win32):**
`spawnSync(node, [...], { env: {} })` and `{ env: { ONE: '1' } }` both
produced the exact same 11 extra vars: HOMEDRIVE, HOMEPATH, LOGONSERVER,
PATH, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERDOMAIN, USERNAME, USERPROFILE,
WINDIR. `env: undefined` produced the full 72-var inherited environment, as
expected. This is deterministic, not something that varies between empty
and near-empty env objects, and it happened via raw `child_process`, with
zero involvement from `Subprocess.run` or any project code — conclusive
that this is Node's own behavior on Windows, not a bug here.
**Fixed:** added `WINDOWS_REQUIRED_ENV_VARS` (`src/bundles/subprocess/types.ts`,
platform-conditional: the 11-item list on `win32`, empty elsewhere).
Rewrote the 3 failing security tests plus the previously-weak 4th (fixed in
DBG-008) to use a new `expectChildEnv()` helper: every explicitly-configured
var is checked for its exact value, and any OTHER key present must be one
of `WINDOWS_REQUIRED_ENV_VARS` or the test fails — same as a literal
`toEqual({})` would have caught a real leak, but no longer fails on Node's
own unavoidable baseline. Added a 6th, dedicated test that pins the
baseline's exact key set, so a future Node version injecting a different
set shows up as a specific, named failure rather than silently passing
through a widened `expectChildEnv` helper.
**Tested:** `tsc --noEmit` clean. Linux: 18/18 subprocess tests pass
(`WINDOWS_REQUIRED_ENV_VARS` is empty there, so this is the same strict
behavior as before — POSIX was never affected by any of this). Full suite:
117 passed, 3 skipped. Mutation-checked: reverted the env filter to spread
the full parent env — still breaks 5 of the 6 security tests (the helper
correctly still fails on a REAL leak; it only tolerates the specific,
named, documented baseline, not an arbitrary one).
**NOT tested:** this fix on the owner's actual Windows machine yet — the
analysis is built directly from the data they reported, but the specific
`expectChildEnv` test code hasn't been run there. Asking for one more
confirmation run.
**Found:** none new beyond the root cause itself.

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
