# Decisions — Coding Harness

> Append-only log. Newest entries at top. Never edit or delete past entries —
> if a decision is reversed, log a new entry that supersedes it and reference
> the old ID.

## D-029 — Egress controls come before the first real cloud run — 2026-09-22
**Decision:** Consent, the egress log, key handling, redaction and the
secrets proxy (Phase 1B.1) are built before the harness sends real code to
a cloud provider, even though `policy-gates` stay last (D-006, Phase 5).
Egress controls cannot be disabled in any profile, including
`profile-minimal`. The "guardrails are disableable in `profile-minimal`"
rule now covers tool gating (`policy-gates`) only.
**Why:** D-006 assumed the model ran locally. With a cloud worker, the first
model call is already an external send, so "test the unguarded path first"
would mean sending code out with no consent and no redaction.
**Known gap:** the consent gate and egress log exist (D-022), but redaction
and the secrets proxy do not yet. Until 1B.1 is done, only send content you
are fine sharing with the provider.
**Affects:** `docs/trd.md` guardrail constraints, `docs/prd.md` success
criteria, `docs/phases.md` (Phase 1B).

## D-028 — Embeddings: start BM25-only, choose a provider later — 2026-09-22
**Decision:** Amends D-008. Phase 2 ranking starts BM25-only. The embeddings
provider is chosen before 2.3, and it must fit the free-tier request limits
(batch many chunks per call, or use a small local model). Anthropic is
removed from the candidate list for now: I could not confirm it offers its
own embeddings API, so verify before listing any provider.
**Why:** Under a 50-requests-a-day free quota (D-023) an API embedding pass
over a repository is not practical, and BM25 needs no requests at all.
**Affects:** `bundle-embeddings`, `bundle-retrieval-rank` (2.3, 2.5).

## D-027 — Pin model IDs, use fallback lists, verify pulls — 2026-09-22
**Decision:** Every provider binding pins an exact model ID and carries an
ordered fallback list of IDs. `doctor` reports a pinned ID that is no longer
available. Ollama pulls (including the curl route) accept the official
`ornith-ai` source only, and record revision, SHA-256 and license. Ornith-1.5
9B is the reference worker as a hypothesis to test in `bench-lite`, not a
settled default. Whether OpenRouter lists it is unverified (owner to check).
**Why:** OpenRouter's free roster changes month to month, and third-party
repositories publish modified builds of popular models, some with safety
alignment removed. Ornith is a reasoning model: it emits think blocks and
needs a reasoning parser and a tool-call parser to return usable tool calls,
so the conformance tests must cover tool calls with thinking on.
**Affects:** Phase 1B.3, benchmark plan, `bundle-model-adapter` config.

## D-026 — Needle is permanent, with a narrowed job — 2026-09-22
**Decision:** Needle ships on every install and never blocks startup. It
owns choosing the sub-agent, choosing the playbook, and choosing a
read-only or allowlisted tool call from the top five retrieved tools, each
only after it matches or beats the worker on the frozen router suite.
Content-bearing calls stay with the worker. Policy decisions stay with the
deterministic gates. The fallback chain is Needle, rules, worker. The
version and license must be pinned in the model store: there is a 26M
original and a 45M "Needle 2", and sources disagree on whether the license
is MIT or Apache 2.0 (both are permissive).
**Why:** On a free cloud tier every decision Needle makes locally is a
request saved, so its first measurable value is requests saved per task.
**Affects:** new bundle `bundle-router` (Phase 4.5), `bench-lite` metrics.

## D-025 — Interface: headless core and terminal wizard first — 2026-09-22
**Decision:** First-run logic (provider connection, credential storage,
consent, budgets, `doctor`) is a headless core with a local API (Phase
1B.2). The terminal wizard is a thin client over it. A desktop app is added
later as another thin client (Phase 1B.4) so the two cannot disagree.
Electron or Tauri stays open until both are measured on the 8 GB machine
(installer size, cold start, idle memory with the core running).
**Why:** The owner asked for a desktop app. Building it before the kernel
exists would put a UI over nothing, and the shell must fit the 8 GB host
budget. Approval prompts for real writes are the most important thing the
desktop app has to show.
**Affects:** new `app-core` and `app-desktop`, Phase 1B.

## D-024 — Sandbox plan: local first, Crabbox free routes, defer the rest — 2026-09-22
**Decision:** `ctx.subprocess` stays the v1 sandbox. At Phase 5, Crabbox is
used in direct, local-container or static-SSH mode. Its hosted broker is
restricted to a GitHub org and is not available to this project, and a
self-hosted broker is optional. Pin the Crabbox version (it is pre-1.0).
CubeSandbox needs a Linux KVM host, so it moves to Phase 8 with Langfuse
export, whose self-hosted stack needs Postgres, ClickHouse, Redis and S3
(Langfuse Cloud would send traces off the machine). Any remote sandbox is a
second data destination and must appear in the consent screen and `doctor`.
**Why:** The test machine is 8 GB with no GPU. Crabbox's laptop prerequisites
include rsync, which Windows does not ship, and the local-container route
needs a Docker-compatible runtime. Measure both before committing.
**Affects:** Phase 5.1, 5.2, 6.3, 8.2, 8.3; `docs/architecture.md`.

## D-023 — Rate limiting and 429 handling — 2026-09-22
**Decision:** A shared `RateLimiter` sits in front of any provider that
takes one: a sliding 60s window (default 16 per minute), an optional daily
ceiling, and one request in flight by default, shared by all sub-agents. Every
attempt counts toward the daily total, failed ones included. The daily
counter can persist to disk. The day boundary is assumed to be UTC (unverified).
The provider maps HTTP 429 to `quota` (daily, not retryable) or
`rate_limit` (retryable, honors `Retry-After`), 402 to `payment`, and
handles gateways that answer 200 with an error body. The adapter still does
not retry (D-017): backoff and fallback belong in the agent loop (1.5).
Budgets on free providers are in requests and tokens, not money.
**Why:** OpenRouter free models are documented (September 2026) at 20
requests per minute and 50 per day until $10 of credit has ever been bought,
then 1,000 per day. The owner chose not to buy credit, so 50 a day is the
working limit and live-model testing has to be sparing.
**Not verified:** the 429 wording heuristic (`per day` / `daily` in the error
text) is a guess from documentation, not checked against the live API.
**Affects:** `bundle-model-adapter` (`rate-limiter.ts`), 1.5 retry policy,
Phase 1B.2 budgets.

## D-022 — Egress consent gate and egress log — 2026-09-22
**Decision:** A provider that reaches a non-loopback host must declare it
(`LLMProvider.egress`). `ctx.llm` refuses the call with `LLMError` kind
`consent` unless config has `egress: { consent: true }`, logs `model.blocked`,
and sends nothing. Allowed remote calls log the destination host and
payload size in `model.request`. LAN addresses count as remote. API keys are
read from config or a named environment variable, sent only in the request
header, and scrubbed from every error message and log entry.
**Why:** With a cloud worker the model call is an external send, so consent
has to be structural, not a habit. This is the smallest slice of the v5
egress policy that could be built and tested now.
**Not built yet:** redaction, the secrets proxy, per-project opt-in and the
consent screen copy (Phase 1B.1, see D-029).
**Affects:** `bundle-model-adapter`, all providers, `docs/trd.md`.

## D-021 — Provider-agnostic worker, cloud path first on this machine — 2026-09-22
**Decision:** The worker is a binding to a provider through `ctx.llm`. A new
`OpenAICompatibleProvider` (`POST {baseUrl}/chat/completions`) covers
OpenRouter and any similar endpoint. OpenRouter is the first cloud target.
Ollama stays as the local provider (D-018 stands for it; its "no API key
anywhere" line applies to Ollama only). Local workers are optional and gated
by hardware. On the 8 GB, no-GPU test machine the worker is a cloud model,
plus Needle and rules. Free launch candidates besides OpenRouter: Ollama
cloud, Groq, Cerebras, Google AI Studio; each is unverified until it passes
the conformance suite and each provider's data policy is shown at consent.
**Why:** The owner's machine cannot run a 9B model next to the OS and the
harness, and wants users without hardware to have a working path.
**Affects:** `bundle-model-adapter`, `docs/trd.md` stack, `docs/prd.md`
goals, Phase 1.2b and 1B.

## D-020 — No blanket claim of offline use or of sending no data — 2026-09-22
**Decision:** The harness collects no telemetry of its own. What leaves the
machine depends on the binding: a cloud binding sends what the model sees to
the provider, under that provider's policy, and a remote sandbox sends the
repository to that sandbox. Only a local binding keeps model traffic on the
machine. No doc, screen or readme may claim otherwise.
**Why:** The owner asked to remove the "completely offline, sends no data"
claim. Provider zero-retention statements are the provider's claims, not
something the harness can verify.
**Affects:** `docs/readme.md`, `docs/prd.md`, `docs/trd.md`, consent copy.

## D-019 — Tool registry is the single call choke point — 2026-09-20
**Decision:** All tool execution goes through `ctx.tools.call()`, which
logs `tool.call` before executing and `tool.result` before returning
(fail-closed on log errors), validates input against the tool's JSON
Schema (ajv, compiled at registration), and emits serial events
`tools/pre-execute` (throw `ToolDeniedError` to block; any hook error also
blocks) and `tools/post-execute` (may redact `ev.result`; a hook error
withholds the output). Hook input is a deep-frozen copy. Tool-level
failures return `{ ok:false, errorKind }` instead of throwing so the model
can recover. `actionClass` is REQUIRED per tool so policy-gates can gate
on it; unclassified tools cannot register. Duplicate names are rejected.
Output is truncated at `maxOutputChars` (default 50,000).
**Why:** A call path that skips logging or hooks bypasses both the audit
trail and policy, so the choke point has to exist from the first version,
not be retrofitted in Phase 5. Model-produced tool input is untrusted, so
it is validated. Small local models mis-format arguments often, and a clear
`invalid_input` message lets the loop retry.
**Alternatives:** hand-rolled schema check (rejected: bug-prone); leaving
hooks to Phase 5 (rejected: retrofit risk). This goes beyond the literal
1.3 criteria and designs the Phase 5 attachment point ahead of use; revisit
when policy-gates are built.
**Affects:** `bundle-tool-registry`, new dependency `ajv`; Phase 5
policy-gates (attach via the events above); 1.5 (map `list()` to
`ToolSpec[]`, feed `ToolResult` back as `tool_result` with `isError`).

## D-018 — Built-in provider is Ollama (local models), not Anthropic — 2026-09-20
**Decision:** `bundle-model-adapter` ships an `OllamaProvider`
(`POST {host}/api/chat`, `stream:false`) as the built-in. Config:
`ollama: { model, baseUrl?, timeoutMs? }`; host falls back to `OLLAMA_HOST`
then `http://localhost:11434`. No API key anywhere. The Anthropic provider
was removed. Supersedes the API-key parts of D-017 (raw fetch, no default
model, and no adapter-level retries still stand).
**Why:** Owner request: run on local Ollama models.
**Consequences to watch:** (1) Small local models often lack reliable
native tool calling, and some models reject `tools` outright (HTTP 400).
1.5's ReAct loop may need a text-format fallback. (2) First request loads
the model, hence the 120s default timeout. (3) Credential/secrets-proxy
guardrails in `trd.md` matter less locally but still apply if a remote
provider is added later. Phase 1.2 success criteria were amended to match.
**Affects:** `bundle-model-adapter`, `phases.md` 1.2, 1.5.

## D-017 — Adapter details: raw fetch, no default model, no retries — 2026-09-20
**Decision:** The Anthropic provider uses `fetch` directly (no SDK). `model`
is required config (no default in code). API key comes from config or
`ANTHROPIC_API_KEY`. The adapter does not retry; `LLMError.retryable` is a
hint for callers.
**Why:** Fewer dependencies and a stable, tiny surface; model choice is
configuration; retry policy belongs where task context exists (agent loop).
**Affects:** `bundle-model-adapter`, 1.5 (retry policy).

## D-016 — Model-adapter owns model-call logging, fail-closed — 2026-09-20
**Decision:** `ctx.llm.complete()` requires a `sessionId`, appends
`model.request` before the provider is called and `model.response` /
`model.error` after. If the log write fails, the model is not called.
**Why:** Puts the "model-visible = logged" invariant at the single choke
point instead of trusting every caller.
**Affects:** 1.5 agent-loop must NOT log model calls itself (it logs its own
steps and tool calls only); 1.6 invariant test.

## D-015 — `ctx.llm` is a thin provider registry — 2026-09-20
**Decision:** `ctx.llm.register(name, provider)` (returns a disposer, used
inside `ctx.effect`) plus `complete({provider?})`. Providers are plain
objects implementing `LLMProvider.complete`. Native tool-use shapes
(`ContentBlock`, `ToolSpec`, `toolCalls`) are in the interface now.
**Why:** `ctx.llm` is a single service key, so multiple providers need a
name->provider map. This refines architecture.md's "no adapter-registry
code" wording: the registry is one `Map`, not a framework. Tool-use shapes
are included now so 1.5 doesn't force a breaking interface change (risk:
designed ahead of use; revisit at 1.5).
**Alternatives:** one Cordis service key per provider (rejected: callers
would need to know provider names at compile time).
**Affects:** `bundle-model-adapter`, 1.5.

## D-014 — Non-harness Python project removed from repo — 2026-09-20
**Decision:** `app.py`, `main.py`, `analyser.py`, `tasks.py`,
`requirements.txt`, `.env.example` (an unrelated "Document Intelligence
Workbench") moved out of the repo (commit `ac8e13d`). Docs moved under `docs/`.
**Why:** Contradicted D-001 (Cordis/TypeScript, not Python) and would
mislead future agents.
**Affects:** repo root layout.

## D-013 — tsconfig uses `moduleResolution: Bundler` — 2026-09-20
**Decision:** `module: ESNext`, `moduleResolution: Bundler`.
**Why:** Cordis's declaration files use extensionless relative imports;
`NodeNext` breaks its types. Runtime is unaffected (tsx/vitest).
**Affects:** all bundles' typechecking. Don't "fix" back to NodeNext.

## D-012 — Pin Cordis to exactly `4.0.0-rc.10` — 2026-09-20
**Decision:** Exact pin, no caret.
**Why:** It is the only published line (`latest` is a release candidate) and
its README says the API may change without notice.
**Affects:** `package.json`. Upgrades are deliberate, logged decisions.
`npm audit` reports dev-only advisories (vitest toolchain); 0 in
production dependencies.

## D-011 — Explicitly out of scope — 2026-09-18
**Decision:** `cloudflare/agentic-inbox`, `langflow-ai/langflow`, and
`Panniantong/Agent-Reach` are explicitly excluded.
**Why:** Agentic-inbox is an email client with no overlap; langflow is a
no-code flow builder for the wrong audience; Agent-Reach is a
social-media/web-scraping capability layer, wrong domain for a coding-only
harness.
**Affects:** scope boundary for the whole project.

## D-010 — Reference-only repos, not runtime dependencies — 2026-09-18
**Decision:** `affaan-m/ECC` and `opendatalab/MinerU` are read for ideas,
not adopted as dependencies.
**Why:** ECC covers nearly every open item simultaneously (68 scoped
sub-agents, hooks-as-events, memory vault with scopes/trust boundaries, an
instinct system with confidence-scored pattern promotion/pruning) — its
hook event model and instinct-confidence design are worth reading, but it's
Claude-Code/Codex-plugin-centric with a Node/Python mix, so not a runtime
dependency. MinerU (PDF/DOCX/PPTX/XLSX-to-markdown, MCP server support) is
an optional add only if sub-agents need to ingest spec/design documents —
not core.
**Affects:** `docs/architecture.md` external dependencies list.

## D-009 — Skills/procedural-memory format: Agent Skills spec — 2026-09-18
**Decision:** Adopt `agentskills/agentskills` (`SKILL.md` folders with
progressive disclosure: name+description always loaded, full instructions
loaded on task match, bundled code/resources loaded on demand).
**Why:** Maps directly onto the Procedural memory tier; use this format
rather than inventing one.
**Affects:** `bundle-skills`, Phase 3.

## D-008 — Embeddings and vector store — 2026-09-18
**Decision:** Embeddings via API providers (OpenAI/Anthropic/Voyage), no
local model hosting for v1. Vector store: LanceDB primary (embedded, no
separate service), Qdrant fallback for multi-user scale.
**Why:** Keeps v1 simple and swappable as a `ctx.llm`-adjacent seam; Qdrant
only brought in once multi-user scale is actually needed.
**Affects:** `bundle-embeddings`, `bundle-vectorstore-lancedb`,
`bundle-vectorstore-qdrant`, Phase 2 and Phase 8.

## D-007 — Eval harness: custom runner + Langfuse fallback — 2026-09-18
**Decision:** Primary eval harness is a custom runner built on Cordis's own
append-only session log (solver/scorer/sandbox concepts borrowed from
Inspect AI's design, not its Python runtime). Langfuse is the
fallback/complement, swapped in for AgentOps.
**Why:** Langfuse is self-hostable, TS-native, and covers tracing + evals +
prompt management + datasets in one tool, matching the adjacent
coding-agent ecosystem's existing integrations.
**Affects:** `bundle-eval-runner`, `bundle-eval-langfuse`, Phase 6.

## D-006 — Policy gate table — 2026-09-18
**Decision:** Five action classes with fixed gates: read-only (autonomous),
sandbox-scoped writes (autonomous, logged), real-fs writes outside sandbox
(approval or confidence-threshold auto-approve), external side-effecting
API calls (always approval), deny-listed actions (hard block, no override).
Implemented via `agent/pre-step` and `tools/pre-execute` — no new mechanism
beyond existing Cordis events.
**Why:** Separates what the model can see from what it's allowed to do,
structurally, rather than relying on prompting alone. Deny-list is
pattern-based (not just command-name-based) so a wrapped/aliased command
can't bypass it; confidence scores are never trusted alone and must be
cross-checked against at least one independent heuristic.
**Affects:** `bundle-policy-gates`, Phase 5.

## D-005 — Browser tool: `vercel-labs/agent-browser` — 2026-09-18
**Decision:** Use `vercel-labs/agent-browser` (native Rust CLI + daemon,
npm-installable, built-in MCP server, tool profiles, domain allowlists,
action-policy JSON, plugin system) instead of the originally-considered
`browser-use/browser-harness`.
**Why:** browser-use/browser-harness is Python-only with no clear advantage
here; agent-browser's plugin system matches the project's own
capability-seam pattern and ships `--content-boundaries` and
`--allowed-domains` directly.
**Affects:** `bundle-browser`, Phase 7, Layer 1/3 guardrails.

## D-004 — Sandbox/execution providers — 2026-09-18
**Decision:** Local subprocess (`ctx.subprocess`) for v1. Remote/isolated
providers: `openclaw/crabbox` (lease-based remote dev/test execution) and
`TencentCloud/CubeSandbox` (sub-60ms VM-isolated boot, E2B-compatible) —
both behind the `ctx.sandbox` seam as separate providers. crabbox for
dev/test leases, CubeSandbox for quick code-execution sandboxes.
**Why:** Separates "real but slower/leased" execution from "fast/frequent
untrusted-code" execution rather than forcing one tool to do both jobs.
**Affects:** `bundle-sandbox-crabbox`, `bundle-sandbox-cubesandbox`, Phase 5.

## D-003 — Awesome-list re-checked against D-001/D-002 — 2026-09-18
**Decision:** Anthropic's multi-agent research writeup, SWE-agent, Citadel,
and `browser-use/browser-harness` flagged as the highest-value remaining
reads from `walkinglabs/awesome-harness-engineering`, not yet pulled in
full. (Note: `browser-use/browser-harness` was superseded by D-005.)
**Why:** Awesome-list itself is a curated list, not a framework — items
worth reading are tracked individually rather than adopting the list
wholesale.
**Affects:** open reading queue, not yet a structural decision.

## D-002 — q-agent-harness treated as design doc only — 2026-09-18
**Decision:** Adopt `kju4q/q-agent-harness`'s memory model and
Map → Guardrails → Feedback-loops framing; do not adopt its code/templates.
**Why:** q-agent-harness is a starter-kit/design doc, not running code — its
ideas are useful, its implementation isn't something to build on.
**Affects:** `bundle-memory`'s 4-tier model, overall guardrail framing
(Layers 1–3 in `docs/trd.md`/architecture).

## D-001 — Stack: Cordis-based, not Python — 2026-09-18
**Decision:** Build on Cordis (TypeScript plugin kernel), not Python.
`deepseek-ai/deepseek-harness`'s own `packages/` are a reference
implementation to study, not necessarily a runtime dependency.
**Why:** deepseek-harness is explicitly labeled developer-preview with
breaking changes expected — safer to take the underlying kernel (Cordis)
as the dependency than the harness built on top of it.
**Affects:** entire stack; every bundle in `docs/architecture.md`.

---
**Next:** Return to [`context.md`](../context.md).
