# Architecture — Coding Harness

## System overview
A Cordis `ctx` (event/service bus) sits at the center; every capability —
model access, tools, agents, filesystem/sandbox — is a plugin registered
under a `ctx` key (`ctx.llm`, `ctx.tools`, `ctx.agents`, `ctx.fs`,
`ctx.sandbox`, etc.). A **profile** (e.g. `profile-coding`) is an ordered
stack of bundles resolved at boot via `cordis.patch.yml`. The orchestrator
(Planner → Executor + ReAct loop) spawns a pool of sub-agents, each a scoped
`ctx` realm with its own tool/memory permissions. Each sub-agent's turn runs
through: retrieval (grep → tree-sitter → rank → top-K → LLM), the hook/
playbook engine (waterfall events at `agent/pre-step`, `tools/pre-execute`,
`tools/post-execute`), and 4-tier memory (hot/episodic/semantic/procedural
with scheduled compaction). Every model-visible event is written to an
append-only session log, which is both the audit trail and the eval
harness's data source.

Model access is provider-agnostic (D-021): a local Ollama server, or any
OpenAI-compatible cloud endpoint such as OpenRouter. What leaves the machine
depends on the binding (D-020). A remote provider is refused unless the user
has consented (D-022), and every remote call is logged with its destination
and size.

## Components

### session-log (`bundle-session-log`)
- **Responsibility:** append-only event log; replay, fork, resume; enforces
  "model-visible = logged" as a runtime invariant.
- **Location:** `src/bundles/session-log/`
- **Depends on:** none (foundation bundle — everything else depends on it).
- **Key files:** `index.ts` (`SessionLog` service), `store.ts` (`JsonlStore`,
  `MemoryStore`), `types.ts`.

### model-adapter (`bundle-model-adapter`)
- **Responsibility:** plug-and-play model provider access via `ctx.llm`.
- **Location:** `src/bundles/model-adapter/`
- **Depends on:** `bundle-session-log`.
- **Config surface:** `default` provider name; `ollama: { model, baseUrl?, timeoutMs? }`
  (host also from `OLLAMA_HOST`); `openaiCompatible: { name?, model, baseUrl, apiKey? | apiKeyEnv?, timeoutMs?, limiter? }`;
  `egress: { consent }`. Further providers register via `ctx.llm.register()` (D-015).
- **Key files:** `index.ts` (`LLMService`, consent gate), `types.ts` (`LLMError` kinds:
  `config`, `auth`, `rate_limit`, `quota`, `payment`, `consent`, and the rest),
  `providers/ollama.ts`, `providers/openai-compatible.ts`, `providers/mock.ts`,
  `rate-limiter.ts` (`RateLimiter`). Logs `model.request/response/error/blocked`
  itself (D-016, D-022). Providers may declare `egress: { host, remote }`.
- **Not built yet:** redaction and the secrets proxy (see `egress` below).

### tool-registry (`bundle-tool-registry`)
- **Responsibility:** `ctx.tools` — tools self-register, no central adapter
  list needed. Also the single call choke point: logging, schema
  validation, and the `tools/pre-execute` / `tools/post-execute` hooks
  (D-019).
- **Location:** `src/bundles/tool-registry/`
- **Depends on:** `bundle-session-log`.
- **Key files:** `index.ts` (`ToolRegistry`), `types.ts` (`ToolDefinition`,
  `ActionClass`, `ToolResult`, `ToolDeniedError`).
- **Config surface:** `maxOutputChars`.

### egress (`bundle-egress`, Phase 1B.1, not built)
- **Responsibility:** per-project opt-in and consent record, redaction before
  every send, secrets proxy (keys injected at the network boundary), endpoint
  allowlist. Cannot be disabled in any profile (D-029).
- **Location:** `src/bundles/egress/`
- **Depends on:** `bundle-session-log`, hooks into `bundle-model-adapter`.
- **Today:** only the consent gate, the egress log fields and key scrubbing
  exist, inside `bundle-model-adapter`.

### app-core (`bundle-app-core`, Phase 1B.2, not built)
- **Responsibility:** headless first-run logic with a local API: provider
  connection, credential storage (OS credential store, encrypted-file
  fallback), consent copy, request and token budgets, `doctor`. The terminal
  wizard and the desktop app are thin clients of it (D-025).
- **Location:** `src/bundles/app-core/`, `src/cli/`
- **Depends on:** `bundle-model-adapter`, `bundle-egress`, `bundle-model-store`.

### model-store (`bundle-model-store`, Phase 1B.3, not built)
- **Responsibility:** verified local models and pinned bindings: source
  allowlist, revision, SHA-256, license record, pinned model ID plus ordered
  fallback list per binding (D-027).
- **Location:** `src/bundles/model-store/`
- **Depends on:** none.

### router (`bundle-router`, Phase 4.5, not built)
- **Responsibility:** `ctx.router`, backed by Needle. Owns choosing the
  sub-agent, the playbook, and read-only or allowlisted tool calls (D-026).
  Fallback chain: Needle, rules, worker. Never blocks startup.
- **Location:** `src/bundles/router/`
- **Depends on:** `bundle-model-store`, `bundle-tool-registry`.

### app-desktop (`app/desktop`, Phase 1B.4, not built)
- **Responsibility:** desktop shell over `app-core`. Electron or Tauri, chosen
  after measurement on the 8 GB machine (D-025).

### subprocess (`bundle-subprocess`)
- **Responsibility:** `ctx.subprocess` — local execution provider for v1.
  No shell (`spawn(..., { shell: false })`) and no implicit environment: a
  spawned process sees only the env vars its caller allowlisted, nothing
  inherited by default. Failures (non-zero exit, a killing signal, timeout,
  abort, command not found) are outcome fields on the result, never thrown.
- **Location:** `src/bundles/subprocess/`
- **Depends on:** none.
- **Config surface:** default `cwd`, `envAllowlist`, `timeoutMs`,
  `maxOutputBytes`; each is overridable per `run()` call.
- **Key files:** `index.ts` (`Subprocess`), `types.ts` (`RunOptions`,
  `RunResult`, `SubprocessError`).
- **Not built yet:** no tool wraps this for the agent loop yet (that's
  Phase 5/1.5); `policy-gates` (Phase 5) will decide which shell-out tool
  calls count as `sandbox-write` vs `real-fs-write`.

### sandbox-crabbox (`bundle-sandbox-crabbox`)
- **Responsibility:** `ctx.sandbox` provider `crabbox` — remote or container
  execution through the Crabbox CLI. Modes used here (D-024): direct provider
  with your own cloud account, `local-container` (needs a Docker-compatible
  runtime), or static SSH to a machine you already have. The hosted broker is
  restricted to a GitHub org and is not used. Pin the version (pre-1.0).
- **Location:** `src/bundles/sandbox-crabbox/`
- **Depends on:** `bundle-subprocess` (CLI shells out).
- **Config surface:** provider mode, provider credentials (through the secrets
  proxy), optional self-hosted broker URL/token.
- **Host notes:** laptop needs git, ssh, ssh-keygen, rsync and curl; rsync is
  not bundled with Windows, so verify on the target machine.

### sandbox-cubesandbox (`bundle-sandbox-cubesandbox`)
- **Responsibility:** `ctx.sandbox` provider `cubesandbox` — sub-60ms
  VM-isolated boot for fast/frequent untrusted-code execution. Deferred to
  Phase 8 (D-024): needs an x86_64 or ARM64 Linux host with KVM.
- **Location:** `src/bundles/sandbox-cubesandbox/`
- **Depends on:** none (E2B-compatible HTTP API).
- **Config surface:** API endpoint, template.

### browser (`bundle-browser`)
- **Responsibility:** `ctx.browser` — capability seam for sub-agent research,
  backed by `vercel-labs/agent-browser`.
- **Location:** `src/bundles/browser/`
- **Depends on:** `bundle-tool-registry`.
- **Config surface:** agent-browser MCP profile (core/network/state/allowed-domains).

### retrieval-grep (`bundle-retrieval-grep`)
- **Responsibility:** `ctx.retrieval.grep` — cheap filter stage of the
  retrieval pipeline.
- **Location:** `src/bundles/retrieval-grep/`
- **Depends on:** `bundle-subprocess`.
- **Config surface:** ripgrep path/flags.

### retrieval-treesitter (`bundle-retrieval-treesitter`)
- **Responsibility:** `ctx.retrieval.parse` — structural parse stage.
- **Location:** `src/bundles/retrieval-treesitter/`
- **Depends on:** none.
- **Config surface:** language grammars to load.

### retrieval-rank (`bundle-retrieval-rank`)
- **Responsibility:** `ctx.retrieval.rank` — hybrid BM25 + embedding ranking.
- **Location:** `src/bundles/retrieval-rank/`
- **Depends on:** `bundle-embeddings`, `bundle-retrieval-grep`,
  `bundle-retrieval-treesitter`.
- **Config surface:** hybrid weight (BM25 vs. embedding).

### embeddings (`bundle-embeddings`)
- **Responsibility:** `ctx.embeddings`. Provider chosen before Phase 2.3 and
  must fit free-tier request limits (D-028); ranking is BM25-only until then.
- **Location:** `src/bundles/embeddings/`
- **Depends on:** `bundle-model-adapter`.
- **Config surface:** provider, model.

### vectorstore-lancedb (`bundle-vectorstore-lancedb`)
- **Responsibility:** `ctx.vectorstore` provider `lancedb` — embedded,
  primary vector store.
- **Location:** `src/bundles/vectorstore-lancedb/`
- **Depends on:** `bundle-embeddings`.
- **Config surface:** local DB path.

### vectorstore-qdrant (`bundle-vectorstore-qdrant`)
- **Responsibility:** `ctx.vectorstore` provider `qdrant` — multi-user
  scale fallback.
- **Location:** `src/bundles/vectorstore-qdrant/`
- **Depends on:** `bundle-embeddings`.
- **Config surface:** host, collection.

### memory (`bundle-memory`)
- **Responsibility:** `ctx.memory` — 4-tier model (hot/episodic/semantic/
  procedural) plus a scheduled compaction job that promotes repeated
  episodic lessons into hot rules or procedures.
- **Location:** `src/bundles/memory/`
- **Depends on:** `bundle-session-log`, `bundle-vectorstore-*`.
- **Config surface:** hot-tier token cap, compaction schedule.

### skills (`bundle-skills`)
- **Responsibility:** `ctx.skills` — Agent Skills spec (`SKILL.md` folders,
  progressive disclosure), mapped onto the procedural memory tier.
- **Location:** `src/bundles/skills/`
- **Depends on:** `bundle-memory` (procedural tier).
- **Config surface:** skills directory path(s).

### agent-loop (`bundle-agent-loop`)
- **Responsibility:** ReAct loop over `ctx.llm` and `ctx.tools`: reason,
  call a tool if the model asked for one, feed the result back, repeat
  until a text-only reply or `maxSteps`. Owns the retry/backoff and
  provider-fallback policy that D-023 assigns to it (`ctx.llm.complete()`
  itself never retries). Logs nothing of its own — every step is already
  captured by `model.request/response/error` and `tool.call/tool.result`
  from the two bundles it calls.
- **Location:** `src/bundles/agent-loop/` (`types.ts`, `index.ts`)
- **Registered as:** `ctx.agentLoop` (a top-level service). The
  `ctx.agents.loop` label in this doc's original diagram described the
  capability, not a literal key — there's no `ctx.agents.*` namespace or
  orchestrator (Phase 4) yet to nest it under.
- **Depends on:** `bundle-model-adapter`, `bundle-tool-registry` (`static
  inject = ['log', 'llm', 'tools']`).
- **Config surface:** `maxSteps`, `reflection`, `provider`,
  `fallbackProviders`, `model`, `system`, `retry: { maxAttempts,
  baseDelayMs, factor, maxDelayMs }`, injectable `sleep` (tests only).
- **Not built yet:** `real-fs-write`/`sandbox-write` action-class routing
  for a shell-out tool (that's `policy-gates`, Phase 5, wrapping
  `ctx.subprocess`); per-binding model ID fallback lists (D-027,
  Phase 1B.3) are a distinct mechanism this bundle doesn't know about — it
  only fails over between already-configured provider *names*.

### orchestrator (`bundle-orchestrator`)
- **Responsibility:** `ctx.agents.orchestrator` — Planner → Executor.
- **Location:** `src/bundles/orchestrator/`
- **Depends on:** `bundle-agent-loop`.
- **Config surface:** max sub-agents, delegation strategy.

### subagent-scope (`bundle-subagent-scope`)
- **Responsibility:** `ctx.agents.spawn` — scoped `ctx` realms per sub-agent
  (Cordis's `core/scope` primitive), each with its own tool permissions,
  memory access, and capability providers.
- **Location:** `src/bundles/subagent-scope/`
- **Depends on:** `bundle-orchestrator`.
- **Config surface:** default tool/memory permissions per sub-agent.

### policy-gates (`bundle-policy-gates`)
- **Responsibility:** hooks on `agent/pre-step`, `tools/pre-execute` —
  enforces the policy table (see below).
- **Location:** `src/bundles/policy-gates/`
- **Depends on:** `bundle-tool-registry`.
- **Config surface:** the policy table.

### eval-runner (`bundle-eval-runner`)
- **Responsibility:** `ctx.eval` — custom eval runner on the session log.
- **Location:** `src/bundles/eval-runner/`
- **Depends on:** `bundle-session-log`.
- **Config surface:** scoring functions, pass/fail thresholds.

### eval-langfuse (`bundle-eval-langfuse`)
- **Responsibility:** `ctx.eval.export` — fallback/complement export to
  Langfuse. Deferred to Phase 8 (D-024).
- **Location:** `src/bundles/eval-langfuse/`
- **Depends on:** `bundle-eval-runner`.
- **Config surface:** Langfuse host, project key.

## Data flow
0. Before any remote model call: the provider's egress host is checked
   against consent (D-022), the payload is redacted (1B.1, not built), the
   rate limiter waits for a slot and counts the attempt (D-023), and the
   request is logged with its destination and size.
1. A task enters the orchestrator, which plans and spawns sub-agents
   (`subagent-scope`) as needed.
2. Each sub-agent's step runs `agent/pre-step` hooks first (content
   boundary markers on external content, prompt-injection pattern check,
   token/cost budget check) — this can reject or rewrite what the model sees.
3. The model reasons (ReAct loop) and may call retrieval (grep → tree-sitter
   → rank → top-K context) or a tool.
4. Every tool call passes through `tools/pre-execute` (policy-gates: allow /
   allow+log / check confidence+hold / always-hold / hard-block).
5. Tool results pass through `tools/post-execute` (egress/credential
   redaction, domain allowlist enforcement, post-hoc secret-leak scan).
6. Episodic memory is written at turn end; compaction periodically promotes
   repeated lessons into hot/procedural tiers.
7. Every step of the above is written to the session log — this is what
   both the audit trail and the eval-runner consume.

## File tree (living document — keep in sync with src/)
```
src/
├── bundles/
│   ├── session-log/
│   ├── model-adapter/
│   │   ├── providers/  (ollama, openai-compatible, mock)
│   │   └── rate-limiter.ts
│   ├── egress/            (planned, 1B.1)
│   ├── app-core/          (planned, 1B.2)
│   ├── model-store/       (planned, 1B.3)
│   ├── router/            (planned, 4.5)
│   ├── tool-registry/
│   ├── subprocess/        (types.ts, index.ts)
│   ├── agent-loop/        (types.ts, index.ts)
│   ├── sandbox-crabbox/
│   ├── sandbox-cubesandbox/
│   ├── browser/
│   ├── retrieval-grep/
│   ├── retrieval-treesitter/
│   ├── retrieval-rank/
│   ├── embeddings/
│   ├── vectorstore-lancedb/
│   ├── vectorstore-qdrant/
│   ├── memory/
│   ├── skills/
│   ├── agent-loop/
│   ├── orchestrator/
│   ├── subagent-scope/
│   ├── policy-gates/
│   ├── eval-runner/
│   └── eval-langfuse/
├── cli/                   (planned, 1B.2: terminal wizard)
└── profiles/
    ├── profile-minimal.yml
    ├── profile-coding.yml
    ├── profile-research.yml
    └── profile-full.yml
app/
└── desktop/               (planned, 1B.4)
```
Bundles marked planned do not exist yet. The rest match `src/` as of
2026-09-22 (session-log, model-adapter, tool-registry, subprocess,
agent-loop are built). See D-031: subprocess's env-allowlist is verified
on Linux only, not yet on Windows.

## Policy table (enforced by `bundle-policy-gates` at `tools/pre-execute`)
| Action class | Gate |
|---|---|
| Read-only (search, grep, retrieval, browsing) | Autonomous, no approval |
| Writes inside sandbox/scratch workspace | Autonomous, logged |
| Writes to real repo/filesystem outside sandbox | Requires approval, or auto-approve below a set confidence threshold |
| External API calls with side effects (email, tickets, spend) | Always requires approval |
| Deny-listed actions (prod credentials, `rm -rf`, force-push) | Hard block, no override |

Model provider calls are not a row in this table. They are governed by
egress consent (D-022), not by `policy-gates`.

## External dependencies
Licenses below were read from public pages on 2026-09-22 (some from
secondary sources, marked). Cordis and `ajv` were checked in the installed
`package.json`. Re-check before relying on any of them. "Cost to run" is what it
takes to use it on the current 8 GB, no-GPU test machine.

| Dependency | License | Cost to run and host notes |
|---|---|---|
| **Cordis** (`cordis@4.0.0-rc.10`, D-012) | MIT (installed package.json) | Free. Small project (about 5 contributors), release candidate. A different, deprecated Discord library is also called cordis: keep the exact pin |
| **`openclaw/crabbox`** | MIT | Free software, pre-1.0. Direct mode bills your own cloud account; `local-container` needs Docker; static SSH needs a machine you have. Hosted broker not available (D-024) |
| **`TencentCloud/CubeSandbox`** | Apache 2.0 | Free software, needs a Linux host with KVM. Deferred to Phase 8 |
| **`vercel-labs/agent-browser`** | Apache-2.0 (from secondary sources; file not read) | Free. Needs a Chromium install. Phase 7 |
| **Needle** (Cactus Compute) | MIT per the repo and Hugging Face card; one catalog also cites Apache 2.0 | Free, about 14 to 28 MB. Original 26M and Needle 2 (45M) both exist: pin one and keep the license file (D-026) |
| **Ornith-1.5 9B** | MIT per the vendor | Free weights. About 5.63 GB at Q4_K_M: does not fit next to the OS on 8 GB. Official `ornith-ai` source only (D-027) |
| **`agentskills/agentskills`** | Apache 2.0 code, CC-BY-4.0 docs | Free. Format only |
| **Langfuse** | MIT except `/ee` folders (commercial) | Self-hosting needs Postgres, ClickHouse, Redis, S3: too heavy for 8 GB. Cloud sends traces out. Deferred to Phase 8 |
| **LanceDB**, **Qdrant** | Believed permissive (Apache-2.0); not re-checked | LanceDB is embedded. Qdrant is a service, Phase 8 |
| **tree-sitter**, **ripgrep** | Believed permissive (MIT); not re-checked | Free |
| **Electron** / **Tauri** | Believed permissive (MIT; Tauri also Apache-2.0); not re-checked | Free. Measure both on the 8 GB machine before choosing (D-025) |
| **OpenRouter** (service) | Not open source: a hosted commercial service | Free models: 20 requests per minute, 50 per day (1,000 after a one-time $10 of credit), per documentation in September 2026. The only non-open piece on the test path (D-023) |

Read-only references (ideas taken, not depended on): `affaan-m/ECC` (hook
event model, instinct-confidence design), `opendatalab/MinerU` (optional
doc-ingestion add, not core), `deepseek-ai/deepseek-harness` (license not
checked).

---
**Next:** Return to [`context.md`](../context.md).
