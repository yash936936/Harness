# Status — Coding Harness

> Updated every run. Newest entry at top.

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
