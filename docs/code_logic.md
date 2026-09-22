# Code logic — Coding Harness

> Populated as non-obvious logic actually appears in code, not front-loaded
> with speculative design. The policy-gate dispatch below is design
> pseudocode (Phase 5, not built); the other sections describe code that
> exists (see `docs/status.md` for how far the build has got).

## Policy-gate dispatch (`tools/pre-execute`)
**Where:** `src/bundles/policy-gates/` (once built — Phase 5)
**What it does:** On every tool call, matches the action's class against
the policy table and either allows, allows-and-logs, checks confidence
before holding for approval, always holds for approval, or hard-blocks:

```
tools/pre-execute:
  match action.class:
    read-only              → allow
    sandbox-scoped-write   → allow, log
    real-fs-write          → check confidence_score
                              if >= threshold: allow, log
                              else: hold, request approval
    external-side-effect   → hold, request approval (always)
    deny-listed            → reject, hard stop, log
```
**Why it's non-obvious:** The deny-list must be pattern-based (e.g. `rm -rf`,
force-push flags, credential-file paths), not command-name-based, or a
wrapped/aliased command bypasses it. The `real-fs-write` confidence score
must never be trusted alone — it's cross-checked against at least one
independent heuristic (file criticality, diff size, whether tests exist for
the touched path) before the threshold check runs. The
"always requires approval" and "hard block" branches have no
confidence-threshold override, by design — this is the one place in the
table that should never become conditional.

## Tool call pipeline (`ToolRegistry.call`)
**Where:** `src/bundles/tool-registry/index.ts`
**What it does:** log `tool.call` -> lookup -> validate input (JSON Schema)
-> `tools/pre-execute` -> execute -> `tools/post-execute` -> log
`tool.result` -> return.
**Why it's non-obvious:** (1) Order matters: the call is logged before
anything can run, and the result is logged before it can be returned, so a
log failure stops the call rather than leaving an unaudited one. (2) Hooks
fail closed: a crashing pre-hook blocks the call and a crashing post-hook
withholds the output. (3) Tool-level failures are returned as
`{ ok:false }`, not thrown; only infrastructure failures (log write) throw.
(4) Hooks get a deep-frozen copy of the input so a hook can't change what
executes.

## Model call logging (`LLMService.complete`)
**Where:** `src/bundles/model-adapter/index.ts`
**What it does:** appends `model.request` before calling the provider and
`model.response`/`model.error` after; `sessionId` is a required field.
**Why it's non-obvious:** it is the only place model calls are logged, so
the agent loop (1.5) must not log them again (D-016).

## Egress consent gate (`LLMService.complete`)
**Where:** `src/bundles/model-adapter/index.ts`
**What it does:** before logging or calling, if the provider declares
`egress.remote` and config lacks `egress: { consent: true }`, it appends
`model.blocked`, throws `LLMError('consent')`, and sends nothing. Otherwise
`model.request` carries `egress: { host, remote, bytes }`.
**Why it's non-obvious:** (1) Consent must be exactly `true`, so a truthy
string does not pass. (2) "Remote" means anything not loopback, LAN included,
because the data still leaves the machine. (3) The check runs before the log
write of the request, so a refused call never appears as a sent request.
(4) A provider that declares no `egress` (the mock) is never gated. A real
network provider that forgets to declare it would bypass the gate, so new
network providers must set it.

## Rate limiter (`RateLimiter.run`)
**Where:** `src/bundles/model-adapter/rate-limiter.ts`
**What it does:** check the daily ceiling, take one of `maxConcurrent`
slots, wait until fewer than `perMinute` requests started in the last 60s,
count the attempt, run the request, release the slot.
**Why it's non-obvious:** (1) The attempt is counted before the request
runs, so failures count too; providers may charge failed calls to the quota.
(2) The daily ceiling is checked before waiting, so a spent quota fails at
once instead of after a minute of sleeping. (3) A slot is handed straight to
the next waiter, so the in-flight count never dips below the real number.
(4) The day boundary is UTC, an assumption. (5) A failed counter write keeps
the in-memory count and sets `lastPersistError`; it does not throw.

## Provider error classification (`OpenAICompatibleProvider.httpError`)
**Where:** `src/bundles/model-adapter/providers/openai-compatible.ts`
**What it does:** 401/403 to `auth`, 402 to `payment`, 429 to `quota` or
`rate_limit`, 5xx to `server`, other 4xx to `invalid_request`; a 200 response
with an error body and no choices is mapped by the code inside the body.
**Why it's non-obvious:** OpenRouter sends both daily-quota exhaustion and
provider congestion as 429. Telling them apart matters because retrying a
spent quota only burns requests. The split is a text match on the error
message (`per day`, `daily`), which is a guess from documentation and is not
verified against the live API. `Retry-After` in seconds becomes
`retryAfterMs`.

## Key handling (`OpenAICompatibleProvider`)
**What it does:** the key comes from config or a named environment variable,
goes only into the `authorization` header, and is replaced with `[redacted]`
in any error text that would contain it.
**Why it's non-obvious:** servers sometimes echo credentials in error
bodies, and error messages are logged. The scrub runs on the message before
the `LLMError` is built, so neither the thrown error nor `model.error` can
carry the key.

## Env allowlist enforcement (`Subprocess.run`)
**Where:** `src/bundles/subprocess/index.ts`
**What it does:** builds the child's env from scratch (never spreads
`process.env`), copying in a key only if it is in the combined allowlist
(bundle config `envAllowlist` plus this call's own), preferring
`opts.env[key]` over `process.env[key]` when both are set. Any key in
`opts.env` that isn't in that combined allowlist throws
`SubprocessError('config')` before `spawn()` is ever called.
**Why it's non-obvious:** (1) There is no implicit base allowlist — not
even `PATH` — so an empty config gives the child an empty environment; a
caller has to name what a command actually needs. (2) A value can be
allowlisted by name without being forced to a specific value: if `opts.env`
doesn't set an allowlisted key, the parent's current value passes through,
which is what lets a caller allowlist `PATH` once and still get whatever
`PATH` happens to be at run time. (3) An unlisted `env` key fails loudly
instead of being silently dropped, because a silently-dropped override
would look like it worked and quietly not run the command the caller
expected (e.g. a `PATH` override that got dropped, so a wrong binary runs).
I mutation-checked this: swapping the base object from `{}` to
`{ ...process.env }` leaked the whole parent environment and broke 3 tests;
skipping the unlisted-key check broke 1.
**Open problem (D-031, unresolved):** this logic is verified correct on
Linux (including via a bundle-independent diagnostic,
`scripts/diagnose-windows-env.cjs`), but the owner's Windows run showed 11
system env vars reaching the child anyway, despite this code never adding
them. The leak is not reproduced here and not yet root-caused — see D-031
before trusting this on Windows.

## Subprocess result vs. thrown error (`Subprocess.run`)
**Where:** `src/bundles/subprocess/index.ts`
**What it does:** a non-zero exit, a killing signal, a timeout, an aborted
call, and a command that never started (`spawnError`) are all fields on the
returned `RunResult`. The only thing `run()` throws is `SubprocessError`
for a config mistake caught before anything spawns.
**Why it's non-obvious:** this mirrors `tool-registry.call`'s choice (a
tool that fails comes back as `{ ok: false }`, not a throw) for the same
reason one level down: whatever eventually wraps `ctx.subprocess` as a tool
needs the exit code and stderr to hand back to the model as the tool
result, not a caught exception to translate. Only a caller bug (a
mismatched allowlist) is exceptional enough to throw.

## Retry and fallback dispatch (`AgentLoop.callModel`)
**Where:** `src/bundles/agent-loop/index.ts`
**What it does:** tries each provider name in `[opts.provider ?? config
.provider, ...fallbackProviders]` in order. On each one: call
`ctx.llm.complete()`; if it throws an `LLMError` where `.retryable` is true
and the attempt count is under `retry.maxAttempts`, wait (`retryAfterMs` if
the provider gave one, else an exponential backoff capped at
`maxDelayMs`) and retry the SAME provider; otherwise stop retrying and move
to the next provider in the chain. Throws the last error once the chain is
exhausted.
**Why it's non-obvious:** (1) The retry/no-retry choice is never
re-derived here — it reads `LLMError.retryable`, which D-023 already
defines on the error class, so this bundle and the provider layer can't
drift out of agreement about which error kinds are worth retrying.
(2) A non-retryable error (`quota`, `payment`, `consent`, `auth`) moves to
the next provider immediately, with zero retries on the one that just
failed — retrying a spent daily quota only spends another request against
it. (3) `retryAfterMs` overrides the computed backoff, not the other way
round, because the provider's own number is more accurate than a guess.
I mutation-checked this: skipping the `retryable` check (so `quota` got
retried anyway) and dropping the per-provider-name override (so a
"fallback" silently kept hitting the same provider) each broke the tests
built to catch exactly that.

## Reflection: bounded to one round (`AgentLoop.run`)
**Where:** `src/bundles/agent-loop/index.ts`
**What it does:** when `reflection` is on and the model gives a text-only
reply, the loop appends one synthetic "double-check yourself" user message
and continues — but only the first time (`requestedReflection`, set before
the continue). A second text-only reply, even after reflection, always
ends the run.
**Why it's non-obvious:** without the one-shot guard, a model that
re-answers "reflectively" every time (plausible instruction-following
behavior, not a bug in the model) would never stop on its own and would
silently degrade into the `maxSteps` boundary case, burning steps and
requests without the caller ever knowing reflection was the reason. Bounding
it to one round makes the behavior predictable and testable; a mutation
that removed the guard broke the "at most once" test immediately.

## Why this bundle logs nothing of its own
**Where:** `src/bundles/agent-loop/index.ts`
**What it does:** `AgentLoop.run()` never calls `ctx.log.append()` — every
model call goes through `ctx.llm.complete()` (which logs
`model.request`/`model.response`/`model.error` itself, D-016) and every
tool call goes through `ctx.tools.call()` (which logs
`tool.call`/`tool.result` itself). The log-completeness test checks this
by reading the session log back and confirming counts match `steps` and
tool calls exactly, with no orphaned `tool.call` missing its `tool.result`.
**Why it's non-obvious:** a second, parallel "loop-level" log (e.g. an
`agent.step` event wrapping each iteration) was considered and dropped —
it would either duplicate what the two lower layers already log correctly,
or drift from it the first time someone changed one without the other.
Relying on the existing choke points keeps "model-visible = logged" true
by construction instead of by two bundles staying in sync by convention.

---
**Next:** Return to [`context.md`](../context.md).
