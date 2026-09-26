# Status — Coding Harness

> Updated every run. Newest entry at top.

## 2026-09-24 — 1B.2: consent-screen copy/data done (slice 3)
**Current phase:** 1B.2, still in progress.
`ctx.appCore.consentScreen(providerName, egress?)` now returns D-020's
general statement plus a specific binding's plain-language destination
plus, only for providers actually checked against a real source
(`ollama`, `openrouter` so far), a dated data-policy claim. An unknown
provider gets an explicit "no checked policy on file" line, not silence
and not a guess.
**Last debug:** DBG-015 — see `docs/debug.md`.
**Last decisions:** D-037 — paraphrased/sourced/dated claims only,
`lookupProviderPolicy` returns `undefined` rather than fabricating
anything for a provider not in the registry.
**Test state:** 176 passed, 3 skipped (up from 169/3). `tsc --noEmit`
clean. Two mutations (fabricate a claim for an unknown provider;
hard-code "local" regardless of actual egress) each broke 2 tests - the
second one is the one that mattered most (a real cloud call falsely
reporting nothing left the machine).
**Not built yet, still open in 1B.2:** provider connection + connection
test; `doctor`; the terminal wizard CLI itself (`src/cli/`);
offline-start test. Budgets, credentials, and consent copy are all
library-grade now but still have no caller - nothing in the codebase
actually presents this consent screen, spends a budget, or reads a
stored key from a real flow yet.
**Next up:** provider connection + connection test is the natural next
slice (the wizard needs something to actually call before it has
anything to show budgets/consent/credentials working against), or
`doctor` (a read-only status check across everything built so far) if the
owner would rather have that first. Confirm before starting.

## 2026-09-24 — 1B.2: credential storage done (slice 2)
**Current phase:** 1B.2, still in progress. `ctx.appCore.credentials`
now exists: `AutoCredentialStore` tries the OS keychain
(`@napi-rs/keyring`), verifies it with a real set/read/compare probe
before trusting it (a broken backend was found, by hand, to fail
*silently* on read in some environments - not a hypothetical), and falls
back automatically to an AES-256-GCM encrypted file when the probe
fails.
**Last debug:** DBG-014 — see `docs/debug.md`.
**Last decisions:** D-036 — verify-don't-trust design for the keychain,
stated (not glossed-over) limitation of the file-store fallback's
encryption, new dependency `@napi-rs/keyring` checked for a Windows
prebuilt binary before adding.
**Test state:** 169 passed, 3 skipped (up from 155/3). `tsc --noEmit`
clean. Two mutations (ignore the probe result; swallow decrypt/tamper
errors) each broke multiple tests.
**Not built yet, still open in 1B.2:** provider connection + connection
test; consent-screen copy/data; `doctor`; the terminal wizard CLI itself
(`src/cli/`); offline-start test; nothing calls `Budgets.spend()` or
`ctx.appCore.credentials` yet from a real flow - both are library-grade
but have no caller until the wizard exists.
**Next up:** continuing 1B.2 - consent-screen copy/data (D-020's "plain
about what the provider receives") is the natural next slice, since
budgets + credentials + egress consent (1B.1) are now all in place for
the wizard to actually present a first-run screen against. Confirm with
the owner before starting.

## 2026-09-24 — 1B.2 started: budgets done, rest of 1B.2 still open
**Current phase:** 1B.2, in progress (not done - it's a multi-piece
phase, sliced same as 1.2b/1.6/1B.1). `bundle-app-core` (`ctx.appCore`)
now exists with `Budgets` (`ctx.appCore.budgets`): task/session/day
soft+hard limits on requests and tokens, a persisted day counter
(survives restart, UTC rollover, mirrors `RateLimiter`'s pattern from
D-023), and an all-or-nothing `spend()` that throws
`BudgetExceededError` with a full status report before recording
anything, if any scope would go over hard.
**Last debug:** DBG-013 — see `docs/debug.md`.
**Last decisions:** D-035 — all-or-nothing spend across scopes (never
leave scopes out of sync with each other); day-counter persistence
copies `RateLimiter`'s design rather than sharing code with it (same
shape, different unit and different consumer).
**Test state:** 155 passed, 3 skipped (up from 140/3). `tsc --noEmit`
clean. Two mutations (disable hard-limit check; break cross-scope
atomicity) each broke several tests.
**Not built yet, still open in 1B.2:** nothing calls `Budgets.spend()`
yet (no real call site to budget-stop test against); provider connection
+ connection test; credential storage (OS credential store + encrypted-
file fallback with a warning); consent-screen copy/data (D-020's "plain
about what the provider receives" requirement); `doctor`; the terminal
wizard CLI itself (`src/cli/`, D-025); offline-start test.
**Next up:** continuing 1B.2 - credential storage is the natural next
slice (budgets and consent both eventually need somewhere to keep a
provider API key; the wizard can't do much without it). Confirm with the
owner before picking a credential-store library, since it likely means a
new dependency and needs to work on the Windows 8 GB target machine
without heavy native build tooling.

## 2026-09-24 — 1B.1 egress controls done
**Current phase:** Phase 1B.1 complete. `bundle-egress` (`ctx.egress`) is
live and mandatory: per-project consent (persisted via `FileConsentStore`
or in-memory for tests), an endpoint allowlist, and redaction of
registered secret values from every outbound request body and the
`model.request` log entry. Sits alongside the existing D-022 binding flag,
not in place of it — both gates must pass for a remote call.
**Last debug:** DBG-012 — see `docs/debug.md`.
**Last decisions:** D-034 — two independent consent gates on purpose (a
binding-config fact vs. a persisted per-project decision), so a refusal's
reason is unambiguous. "Secrets proxy" turned out to already be satisfied
structurally for provider API keys (D-022) — 1B.1's real addition is
`redactValue` for *other* secrets in message/tool content.
**Test state:** 140 passed, 3 skipped (up from 122/3). `tsc --noEmit`
clean. Three separate mutations (bypass project-consent check, bypass
allowlist check, skip redaction) each broke exactly the test built for it.
**Known limitations (not blocking, logged in D-034):**
`FileConsentStore` is a plain JSON file, fine for one process, not
concurrency-safe. Redaction matches literal registered secret values only
— no pattern-based detection of an unregistered credential.
**Not built yet:** consent-screen copy and the interactive wizard (1B.2).
**Next up:** 1B.2 (wizard core, budgets, `doctor`), 1B.3 (model store and
pinning), 1B.4 (desktop shell) remain in Phase 1B, or Phase 2 (retrieval
pipeline) — owner said Phase 2 is next after 1B.1, so that's the plan
unless redirected.

## 2026-09-24 — 1.6 `profile-minimal` done; Phase 1 complete
**Current phase:** Phase 1 (`profile-minimal` kernel) — all of 1.1-1.6 now
Done. `bootProfileMinimal()` composes session-log, model-adapter,
tool-registry, subprocess and agent-loop behind one config call.
**Last debug:** DBG-011 — see `docs/debug.md`.
**Last decisions:** D-033 — `profile-minimal` boots via a plain TS
composer (`ctx.plugin()` × 5), not real `cordis.patch.yml`, because the
loader that mechanism needs (`@cordisjs/plugin-loader` +
`@cordisjs/plugin-include`) is an uninstalled optional peer dependency of
`cordis`. Reopen for `profile-research`/`profile-full` if multiple named,
independently loadable profiles or hot reload become necessary.
**Test state:** 122 passed, 3 skipped (up from 117/3). `tsc --noEmit`
clean. New `test/profile-minimal.test.ts` mutation-checked (a shared-ctx
simulation broke 3 of 5 tests).
**Not built yet:** no real provider (Ollama/OpenRouter) has been run
through the composed profile end-to-end yet - `test/profile-minimal.test.ts`
uses `MockProvider` throughout, same as 1.5. That's naturally covered once
a real task is run against `profile-minimal` with `modelAdapter.ollama`
configured, which isn't blocking (the loop and the wire-format adapters
are each independently tested against real shapes already).
**Open for the owner, unchanged from before:** Electron/Tauri measurement
(D-025), Needle version to pin (D-026), confirm `qwen2.5-coder:3b-instruct`
speed (D-030).
**Next up:** Phase 1B (egress controls, 1B.1) is next per `phases.md` — it
must land before the harness sends real code to a cloud provider — or
Phase 2 (retrieval pipeline) if cloud access isn't needed yet. Confirm
which with the owner before starting.

## 2026-09-22 — D-031 resolved: Windows behavior root-caused, 1.6 un-gated
**What happened:** the owner ran `scripts/diagnose-windows-env.cjs` and
reported the output. It conclusively showed the "leak" is Node's own,
deterministic, platform-mandatory behavior on Windows (11 non-secret
baseline env vars always injected when spawning), not a bug in this
project and not machine-specific — a raw, bundle-independent `spawnSync`
call reproduced it with zero involvement from our code.
**Status change:** 1.4 is now Done and verified on Linux AND Windows
(D-032 supersedes the "not verified" framing in D-031, without deleting
that entry). 1.6 (`profile-minimal`) is un-gated.
**What I did:** added `WINDOWS_REQUIRED_ENV_VARS` as an explicit,
documented, platform-conditional constant; rewrote the security tests to
check the actually-achievable property (nothing beyond the allowlist plus
this fixed, named baseline) via a new `expectChildEnv()` helper, plus a
dedicated test pinning the baseline's exact contents so a future Node
change would surface as a specific failure. Corrected the "not even PATH"
absolute claim in `readme.md`/`code_logic.md` to the precise version.
**Test state:** 117 passed, 3 skipped on Linux (unaffected — the baseline
constant is empty there, so POSIX behavior is unchanged from before any of
this). Mutation-checked that a real full-env leak still fails 5 of 6
security tests even with the new, more permissive-on-Windows helper.
**NOT yet done:** the owner hasn't re-run the actual test suite on Windows
with this fix applied — the analysis is solid from the diagnostic data,
but I'd like that confirmation before calling this fully closed.
**Open for the owner:** run `npx vitest run test/subprocess.test.ts` on
Windows one more time to confirm all 18 pass now; Electron/Tauri
measurement (D-025); Needle version to pin (D-026); confirm
`qwen2.5-coder:3b-instruct` speed (D-030).
**Next up:** 1.6 (`profile-minimal` end-to-end wiring) — no longer blocked.

## 2026-09-22 — 1.5 agent-loop done (built in parallel with the D-031 fix, per owner)
**Current phase:** Phase 1; 1.1–1.5 done. 1.6 (profile-minimal) is next,
but is explicitly gated on D-031 being resolved and re-verified on
Windows first (see phases.md 1.6) — a runnable profile that shells out is
exactly where an unverified env-allowlist would matter for real. 1.5
itself has no dependency on subprocess (only `MockProvider`, `ctx.llm`,
`ctx.tools`), so building it in parallel with the D-031 fix, as the owner
asked, didn't touch anything D-031-related.
**Last debug:** DBG-009 (1.5). D-031 (env-allowlist on Windows) is still
open — see the previous entry below; nothing here resolves it.
**Docs changed:** `phases.md` (1.5 Done, full testing detail; 1.6 marked
gated on D-031), `architecture.md` (agent-loop detail, registered-as-
`ctx.agentLoop` note, file tree), `code_logic.md` (retry/fallback dispatch,
bounded reflection, why no loop-level logging), `debug.md`, this file.
**Test state:** 116 passed, 3 skipped (live). 15 new agent-loop tests,
mutation-checked (skipped retryable check, loosened maxSteps, removed
reflect-once guard, dropped provider override each break the intended
test).
**Not built yet:** no real provider has been run through the loop end to
end (`MockProvider` only); that happens once 1.6 composes
`profile-minimal` — which is blocked on D-031 first.
**Open for the owner, unchanged plus one:** Electron/Tauri measurement
(D-025), Needle version to pin (D-026), confirm `qwen2.5-coder:3b-instruct`
speed (D-030), and — still the most important one — run
`node scripts/diagnose-windows-env.cjs` on Windows and report the output
(D-031), which is what unblocks 1.6.
**Next up:** resolve and re-verify D-031, then 1.6 (`profile-minimal`
end-to-end wiring).

## 2026-09-22 — Windows run found a real gap: env-allowlist not verified there
**What happened:** the owner ran the 1.4 work on their actual Windows
machine (the whole point of testing there). 3 of 5 env-allowlist security
tests failed: a child process received 11 system env vars (PATH, USERNAME,
TEMP, and 8 more) that it should not have, with an empty or near-empty
allowlist. The named test secret did not leak in that run. One passing
test turned out to be weak (checked only one var, not the whole
environment) and has been fixed to check fully.
**Status change:** 1.4 downgraded from "Done" to "Done on Linux, NOT
verified on Windows" (D-031). Don't treat the env-allowlist as a real
security boundary on Windows until this is resolved.
**What I did:** fixed the weak test; wrote and self-tested (on Linux)
`scripts/diagnose-windows-env.cjs`, a dependency-free diagnostic that
isolates whether this is Node/Windows platform behavior or something
specific to this project's code, independent of `src/bundles/subprocess`.
Did NOT ship a guessed fix to the actual leak — I have no Windows machine
to verify one on, and a fix I can't confirm works is worse than an honest
"not yet verified."
**Test state:** 101 passed, 3 skipped on Linux (unchanged, since the fixed
test still passes here). Windows: last known state 98 passed / 3 failed,
pending a re-run after this commit (the fix only closes the assertion gap,
it doesn't address the leak, so 2 of the 3 Windows failures are expected to
still fail until D-031 is resolved).
**Next up, in order:** (1) owner runs
`node scripts/diagnose-windows-env.cjs` on Windows and reports the output —
this decides whether the fix belongs in `Subprocess.run` or somewhere
platform-specific; (2) once resolved and re-verified on Windows, resume 1.5
(agent-loop).

## 2026-09-22 — 1.4 subprocess done
**Current phase:** Phase 1; 1.1 through 1.4 done. Next is 1.5 (agent-loop).
**Last debug:** DBG-007 (1.4). Includes a near-miss note: a doc-editing
script bug briefly truncated `phases.md` to empty; caught via `wc -l`
before commit and reverted with git, nothing lost.
**Last decisions:** none new; D-030 (previous entry) still current.
**Docs changed:** `phases.md` (1.4 marked Done, full detail),
`architecture.md` (subprocess detail, file tree), `code_logic.md` (env
allowlist and result-vs-throw logic), `debug.md`, this file.
**Test state:** 101 passed, 3 skipped (live). 17 new subprocess tests,
mutation-checked (env leak, skipped allowlist guard, swallowed exit code
each break the intended test).
**Not built yet:** no tool wraps `ctx.subprocess` for the agent loop; that
plus the `sandbox-write`/`real-fs-write` action-class call for a shell-out
tool is 1.5 and Phase 5 (`policy-gates`).
**Open for the owner:** unchanged — Electron/Tauri measurement (D-025),
Needle version to pin (D-026), confirm `qwen2.5-coder:3b-instruct` speed
and whether the 7B tag is also worth trying (D-030). Also: run
`npx vitest run test/subprocess.test.ts` on the actual Windows machine to
confirm it behaves the same there (only run in Linux sandbox so far).
**Next up:** 1.5 agent-loop — ReAct loop over 1.2 to 1.4, with the retry
policy from D-023.

## 2026-09-22 — Reference worker: local Ollama, not OpenRouter
**What changed:** the owner checked OpenRouter's model search directly —
"ornith" returns "No results found." Ornith-1.5 9B is confirmed absent from
OpenRouter (closes the open item from D-027 and the prior status entry). The
owner will run a model locally through Ollama for now rather than a cloud
provider. Reference model set to `qwen2.5-coder:3b-instruct` (D-030), sized
for the 8 GB, no-GPU machine; `qwen2.5-coder:7b-instruct` recorded as a
stretch option, not default, since 7B is reported to need the whole 8 GB on
its own with no headroom for the OS, harness host and Needle. No code
changed: `OllamaConfig.model` already takes any tag with no built-in
default (D-018), so this only updates the docs, decisions and status.
**Docs changed:** `decisions.md` (D-030), `trd.md`, `readme.md`.
**Test state:** unchanged, 84 passed, 3 skipped (live).
**Open for the owner:** still the Electron/Tauri measurement (D-025) and
which Needle version to pin (D-026). Confirm `qwen2.5-coder:3b-instruct`
actually runs at an acceptable speed on the 8 GB machine; if it does, decide
whether to also try the 7B tag.
**Next up:** 1.4 subprocess, then 1.5 agent-loop, then 1.6 profile-minimal.

## 2026-09-22 — Cloud provider path, docs brought up to date
**Current phase:** Phase 1; 1.1, 1.2, 1.2b, 1.3 done. Next is 1.4.
**Last debug:** DBG-006 (1.2b).
**Last decisions:** D-020 to D-029: data claim rewritten, provider-agnostic
worker with OpenRouter first, egress consent, rate limiting, sandbox plan
(Crabbox free routes, CubeSandbox and Langfuse deferred), interface plan,
Needle, model pinning, embeddings BM25-first, egress before first cloud run.
**Docs changed:** `context.md`, `decisions.md`, `phases.md` (1.2b, Phase 1B,
4.5, amended 1.5, 2.3, 2.5, 5.1, 5.2, 6.3), `architecture.md` (new planned
bundles, dependency register), `trd.md`, `prd.md`, `appflow.md`,
`code_logic.md`, `workflow.md`, `readme.md`.
**Test state:** 84 passed, 3 skipped (live).
**Watch:**
- Free OpenRouter quota is 50 requests a day (owner chose not to buy the $10
  credit), so live tests must be sparing. Use the mock and recorded fixtures.
- Redaction and the secrets proxy are not built. Do not send real code to a
  cloud provider until 1B.1 exists, or accept that content is unredacted.
- The 429 quota heuristic is unverified against the live API.
**Open for the owner:** is Ornith-1.5 9B listed on OpenRouter for your
account; run the Electron and Tauri measurement on the 8 GB machine; which
Needle version to pin.
**Next up:** 1.4 subprocess (env allowlist security test), then 1.5
agent-loop with the retry policy from D-023, 1.6 profile-minimal, then 1B.1.

## 2026-09-20 — 1.2 done, 1.3 done
**Current phase:** Phase 1; 1.1, 1.2, 1.3 done. Next is 1.4.
**Last debug:** DBG-005 (1.3), DBG-004 (1.2 live).
**Last decisions:** D-019 (tool registry choke point, hooks, required
`actionClass`, `ajv`).
**Watch:** live tool-calling with a real local model is unverified until
1.5; expect ~25s per reply on the current setup.
**Next up:** 1.4 subprocess (env allowlist security test is the important
one), then 1.5 agent-loop, 1.6 profile-minimal.

## 2026-09-20 — 1.2 switched to Ollama
**Current phase:** Phase 1, sub-phase 1.2 (live-call verification pending).
**Last debug:** DBG-003. **Last decisions:** D-018 (Ollama replaces Anthropic).
**Blocked on:** run once with Ollama running and a model installed:
`HARNESS_LIVE=1 OLLAMA_MODEL=<installed tag> npx vitest run test/model-adapter.test.ts`
then log the result and mark 1.2 Done.
**Next up:** 1.3 tool-registry (independent of the live test).

## 2026-09-20 — Sub-phases 1.1 done, 1.2 code-complete
**Current phase:** Phase 1, sub-phase 1.2 (live-call verification pending).
**Last debug:** DBG-002 (1.2), DBG-001 (1.1).
**Last decisions:** D-012 to D-017 (Cordis pin, Bundler resolution, Python
project removed, `ctx.llm` design, adapter-owned logging).
**Blocked on:** run the live test once:
`HARNESS_LIVE=1 ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=... npx vitest run test/model-adapter.test.ts`
and log the result; only then mark 1.2 Done.
**Next up:** 1.3 tool-registry (can proceed in parallel), then 1.4
subprocess, 1.5 agent-loop, 1.6 profile-minimal.

## 2026-09-18 — Docs system scaffolded from design draft
**Current phase:** Pre-Phase 1 — no code yet. Full architecture, bundle
list, profile composition, and guardrail design are locked (see
`docs/decisions.md` D-001 through D-011).
**Last debug:** DBG-000 — docs scaffold only, N/A.
**Last decisions:** D-011 — explicitly out-of-scope repos noted.
**Next up:** Confirm real project root path (currently placeholder
`~/projects/coding-harness`), then hand sub-phase 1.1 (session-log bundle)
to opencode. `docs/phases.md` now breaks every phase into sub-phases with
their own success criteria and tests — work one sub-phase at a time.

---
**Next:** Return to [`context.md`](../context.md).
