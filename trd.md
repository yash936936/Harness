# TRD — Coding Harness

## Stack
- **Runtime/language:** TypeScript, built on **Cordis** (plugin kernel for
  composable services/events — the "everything is a plugin" model taken from
  `deepseek-ai/deepseek-harness`, whose own `packages/` are studied but not
  depended on).
- **Model access:** API-based model adapters (OpenAI/Anthropic/etc.) behind
  `ctx.llm`, plug-and-play — new provider = new bundle, no adapter-registry
  code needed.
- **Embeddings:** API providers (OpenAI/Anthropic/Voyage) — no local model
  hosting for v1.
- **Vector store:** LanceDB (embedded, primary) with Qdrant as a fallback
  for multi-user scale.
- **Sandbox/execution:** local subprocess (`ctx.subprocess`) for v1;
  `openclaw/crabbox` (lease-based remote dev/test execution — Firecracker,
  E2B, Docker, Hetzner, AWS) and `TencentCloud/CubeSandbox` (sub-60ms
  VM-isolated boot, E2B-compatible) as separate `ctx.sandbox` providers.
- **Browser tool:** `vercel-labs/agent-browser` (native Rust CLI + daemon,
  npm-installable, built-in MCP server, domain allowlists, action-policy
  JSON, plugin system).
- **Eval/tracing:** custom eval runner on Cordis's own session log
  (solver/scorer/sandbox concepts borrowed from Inspect AI's design, not its
  Python runtime), with Langfuse as fallback/complement (self-hostable,
  TS-native, tracing + evals + prompt management + datasets).
- **Skills/procedural memory format:** Agent Skills spec
  (`agentskills/agentskills`) — `SKILL.md` folders with progressive
  disclosure.

## System requirements
- Node/TypeScript runtime capable of running Cordis-based plugin kernels.
- No offline requirement specified yet — API-dependent for model access and
  embeddings by design (open — confirm with user if offline/local-model
  support becomes a requirement later).
- No performance/latency targets specified yet (open — confirm with user).

## Integration points
- Model provider APIs (OpenAI/Anthropic/etc.) via `ctx.llm` adapters.
- Embedding provider APIs (OpenAI/Anthropic/Voyage) via `ctx.embeddings`.
- `openclaw/crabbox` broker (URL/token) for leased remote sandbox execution.
- `TencentCloud/CubeSandbox` HTTP API (E2B-compatible) for fast sandboxed
  execution.
- `vercel-labs/agent-browser` MCP server for browser-based research.
- Langfuse host + project key for eval export (optional, complement path).

## Non-functional requirements
- **Security:** secrets-proxy layer injects credentials at the network-call
  boundary; sub-agents never hold raw API keys in context or logs; deny-listed
  actions (prod credentials, `rm -rf`, force-push) are pattern-based hard
  blocks with no confidence-threshold override.
- **Reliability:** append-only session log enforces "model-visible = logged"
  as a runtime invariant, giving fork/resume/replay and a real audit trail.
- **Observability/logging:** every guardrail event (rejection, hold,
  approval, deny-list hit) is itself a session-log event — this is what the
  eval-runner and Langfuse export both consume. Ties directly into this
  project's own `docs/debug.md`/`docs/status.md` convention: what the
  session log is to the running system, those two files are to the human
  dev loop.

## Known technical constraints
- Guardrails are config, not code, per profile: `profile-minimal` may run
  with `policy-gates` disabled (trusted single-agent smoke tests);
  `profile-coding` and above must never disable them — this is a
  profile-level requirement, not a runtime toggle a sub-agent could flip.
- Confidence scoring for real-fs-write actions must combine the model's own
  self-reported score with at least one independent heuristic signal (file
  criticality, diff size, whether tests exist) — never trust the
  self-reported score alone.
- Build order is fixed by dependency, not preference: `profile-minimal` →
  retrieval → memory/skills → orchestrator/sub-agents → policy-gates last
  (so the unguarded path is testable before enforcement is layered on).

---
**Next:** Return to [`context.md`](../context.md).
