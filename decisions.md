# Decisions — Coding Harness

> Append-only log. Newest entries at top. Never edit or delete past entries —
> if a decision is reversed, log a new entry that supersedes it and reference
> the old ID.

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
