# TRD — Coding Harness

## Stack
- **Runtime/language:** TypeScript, built on **Cordis** (plugin kernel for
  composable services/events — the "everything is a plugin" model taken from
  `deepseek-ai/deepseek-harness`, whose own `packages/` are studied but not
  depended on).
- **Model access:** provider-agnostic behind `ctx.llm` (D-021). Built in:
  Ollama (local, D-018) and an OpenAI-compatible provider for OpenRouter and
  similar endpoints, plus a mock. A new provider registers through
  `ctx.llm.register()` (D-015). A shared `RateLimiter` fronts providers with
  request limits (D-023). Local workers are optional and gated by hardware;
  on an 8 GB, no-GPU machine the worker is a cloud model.
- **Router:** Needle, a small local model (about 14 to 28 MB), for choosing
  sub-agents, playbooks and read-only tool calls (D-026).
- **Reference worker (current):** local Ollama, `qwen2.5-coder:3b-instruct`
  (about 1.9 GB at Q4_K_M), chosen for the owner's 8 GB, no-GPU machine
  (D-030). Ornith-1.5 9B is confirmed absent from OpenRouter and stays a
  benchmark-only entry for machines with more RAM (D-027). It is the one
  local model every install carries.
- **Embeddings:** provider chosen before Phase 2.3 and must fit free-tier
  request limits; ranking is BM25-only until then (D-028).
- **Vector store:** LanceDB (embedded, primary) with Qdrant as a fallback
  for multi-user scale.
- **Sandbox/execution:** local subprocess (`ctx.subprocess`) for v1;
  `openclaw/crabbox` in direct, local-container or static-SSH mode at Phase 5
  (hosted broker not available); `TencentCloud/CubeSandbox` deferred to Phase 8
  (needs a Linux KVM host). Both sit behind the `ctx.sandbox` seam (D-024).
- **Interface:** headless core with a local API, a terminal wizard client,
  then a desktop shell (Electron or Tauri, measured first) (D-025).
- **Browser tool:** `vercel-labs/agent-browser` (native Rust CLI + daemon,
  npm-installable, built-in MCP server, domain allowlists, action-policy
  JSON, plugin system).
- **Eval/tracing:** custom eval runner on Cordis's own session log
  (solver/scorer/sandbox concepts borrowed from Inspect AI's design, not its
  Python runtime). Langfuse export is deferred to Phase 8 (D-024).
- **Skills/procedural memory format:** Agent Skills spec
  (`agentskills/agentskills`) — `SKILL.md` folders with progressive
  disclosure.

## System requirements
- Node 20.3 or newer and TypeScript, able to run Cordis-based plugin kernels.
- Host footprint: the harness host plus Needle must fit in 8 GB. That budget
  applies to every install. Local worker models, if used, need more.
- Test machine: 8 GB RAM, no GPU (owner-stated). Currently running a local
  worker through Ollama (`qwen2.5-coder:3b-instruct`, D-030); a cloud worker
  through an OpenAI-compatible provider remains supported and is the
  fallback path for machines that cannot run a local model.
- Not an offline product by default (D-020). Cloud bindings need the network
  and send what the model sees to the provider. Local bindings keep model
  traffic on the machine. With the network off the harness must still start
  and say what works.
- No performance or latency targets specified yet (open, confirm with owner).

## Integration points
- Model providers via `ctx.llm`: a local Ollama server, or OpenAI-compatible
  endpoints (OpenRouter first). Free launch candidates: Ollama cloud, Groq,
  Cerebras, Google AI Studio, each unverified until it passes the conformance
  suite. Each provider's stated data policy is shown at consent, with its
  check date, as the provider's claim.
- Embedding provider or small local model via `ctx.embeddings` (D-028).
- `openclaw/crabbox` CLI (direct, local-container or static-SSH) for remote
  or container sandbox execution. A remote sandbox is a second data
  destination.
- `TencentCloud/CubeSandbox` HTTP API (E2B-compatible), Phase 8.
- `vercel-labs/agent-browser` MCP server for browser-based research.
- Langfuse host + project key for eval export (optional, Phase 8).

## Non-functional requirements
- **Security:** secrets-proxy layer injects credentials at the network-call
  boundary; sub-agents never hold raw API keys in context or logs; deny-listed
  actions (prod credentials, `rm -rf`, force-push) are pattern-based hard
  blocks with no confidence-threshold override. Today, provider keys are read
  from config or an environment variable, sent only in the request header,
  and scrubbed from errors and logs (D-022); the proxy itself is Phase 1B.1.
- **Data egress:** a remote provider is refused without consent, and every
  remote call is logged with destination host and payload size (D-022).
  Redaction before send is Phase 1B.1. Provider retention and training
  policies are the provider's claims and are shown as such (D-020).
- **Rate limits:** requests per minute and per day are first-class limits.
  Free OpenRouter models were documented in September 2026 at 20 per minute
  and 50 per day (1,000 after a one-time $10 credit purchase). Limits
  change; the limiter reads them from config (D-023).
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
  Egress controls are different: they cannot be disabled in any profile,
  including `profile-minimal` (D-029).
- Confidence scoring for real-fs-write actions must combine the model's own
  self-reported score with at least one independent heuristic signal (file
  criticality, diff size, whether tests exist) — never trust the
  self-reported score alone.
- Build order is fixed by dependency, not preference: `profile-minimal` →
  egress controls before any real cloud run (1B.1) → retrieval →
  memory/skills → orchestrator/sub-agents → policy-gates last (so the
  unguarded tool path is testable before enforcement is layered on).
- The model adapter does not retry (D-017). Retry, backoff and provider
  fallback live in the agent loop and follow `LLMError.kind` (D-023).

---
**Next:** Return to [`context.md`](../context.md).
