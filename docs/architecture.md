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

## Components

### session-log (`bundle-session-log`)
- **Responsibility:** append-only event log; replay, fork, resume; enforces
  "model-visible = logged" as a runtime invariant.
- **Location:** `src/bundles/session-log/`
- **Depends on:** none (foundation bundle — everything else depends on it).
- **Key files:** TBD at implementation (open — confirm with opencode once
  Phase 1 starts).

### model-adapter (`bundle-model-adapter`)
- **Responsibility:** plug-and-play model provider access via `ctx.llm`.
- **Location:** `src/bundles/model-adapter/`
- **Depends on:** `bundle-session-log`.
- **Config surface:** provider (OpenAI/Anthropic/etc.), API key.

### tool-registry (`bundle-tool-registry`)
- **Responsibility:** `ctx.tools` — tools self-register, no central adapter
  list needed.
- **Location:** `src/bundles/tool-registry/`
- **Depends on:** `bundle-session-log`.

### subprocess (`bundle-subprocess`)
- **Responsibility:** `ctx.subprocess` — local execution provider for v1.
- **Location:** `src/bundles/subprocess/`
- **Depends on:** none.
- **Config surface:** working dir, env allowlist.

### sandbox-crabbox (`bundle-sandbox-crabbox`)
- **Responsibility:** `ctx.sandbox` provider `crabbox` — leased remote
  dev/test execution (Firecracker/E2B/Docker/Hetzner/AWS via CLI shell-out).
- **Location:** `src/bundles/sandbox-crabbox/`
- **Depends on:** `bundle-subprocess` (CLI shells out).
- **Config surface:** broker URL/token, provider (hetzner/aws/local-container/etc.).

### sandbox-cubesandbox (`bundle-sandbox-cubesandbox`)
- **Responsibility:** `ctx.sandbox` provider `cubesandbox` — sub-60ms
  VM-isolated boot for fast/frequent untrusted-code execution.
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
- **Responsibility:** `ctx.embeddings`.
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
- **Responsibility:** `ctx.agents.loop` — default ReAct implementation.
- **Location:** `src/bundles/agent-loop/`
- **Depends on:** `bundle-model-adapter`, `bundle-tool-registry`.
- **Config surface:** max steps, reflection on/off.

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
  Langfuse.
- **Location:** `src/bundles/eval-langfuse/`
- **Depends on:** `bundle-eval-runner`.
- **Config surface:** Langfuse host, project key.

## Data flow
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
│   ├── tool-registry/
│   ├── subprocess/
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
└── profiles/
    ├── profile-minimal.yml
    ├── profile-coding.yml
    ├── profile-research.yml
    └── profile-full.yml
```
(Exact file names inside each bundle folder are TBD until Phase 1 —
`code_logic.md` gets updated once opencode's actual implementation exists.)

## Policy table (enforced by `bundle-policy-gates` at `tools/pre-execute`)
| Action class | Gate |
|---|---|
| Read-only (search, grep, retrieval, browsing) | Autonomous, no approval |
| Writes inside sandbox/scratch workspace | Autonomous, logged |
| Writes to real repo/filesystem outside sandbox | Requires approval, or auto-approve below a set confidence threshold |
| External API calls with side effects (email, tickets, spend) | Always requires approval |
| Deny-listed actions (prod credentials, `rm -rf`, force-push) | Hard block, no override |

## External dependencies
- **Cordis** — plugin kernel; the actual runtime dependency (not
  deepseek-harness's own packages).
- **`openclaw/crabbox`** — leased remote sandbox provider.
- **`TencentCloud/CubeSandbox`** — fast VM-isolated sandbox provider.
- **`vercel-labs/agent-browser`** — browser tool (chosen over
  `browser-use/browser-harness`, which is Python-only with no clear
  advantage here).
- **LanceDB** / **Qdrant** — vector stores.
- **Langfuse** — eval/tracing export (chosen over AgentOps: TS-native).
- **`agentskills/agentskills`** — Agent Skills spec for procedural memory.
- Read-only references (ideas taken, not depended on): `affaan-m/ECC`
  (hook event model, instinct-confidence design), `opendatalab/MinerU`
  (optional doc-ingestion add, not core).

---
**Next:** Return to [`context.md`](../context.md).
