# Phases — Coding Harness

> Work through phases in order. Mark a phase done only when its files exist,
> work, and are logged in `debug.md`. Update `status.md` after each phase.
> Build order follows the design doc directly: validate the kernel first,
> then layer in retrieval/memory/skills to reach `profile-coding` (the real
> v1 target), then `profile-research`, then `profile-full` — policy-gates
> is deliberately built last within `profile-coding` so the unguarded path
> is testable before enforcement is layered on top.

## Phase 1 — Kernel skeleton (`profile-minimal`)
**Goal:** A single agent runs end-to-end with a full audit trail — no
orchestrator, no sub-agents, no memory beyond the session log.
**Files touched:**
- `src/bundles/session-log/` — append-only event log, replay/fork/resume
- `src/bundles/model-adapter/` — first model provider adapter
- `src/bundles/tool-registry/` — tool self-registration
- `src/bundles/subprocess/` — local execution
- `src/bundles/agent-loop/` — ReAct loop
- `src/profiles/profile-minimal.yml`
**Done when:** a single-agent, single-task run completes with a
reconstructable session log ("model-visible = logged" verifiably holds).
**Status:** Not started

## Phase 2 — Retrieval pipeline
**Goal:** Classical RAG working (grep → tree-sitter → rank → top-K → LLM).
**Files touched:**
- `src/bundles/retrieval-grep/`
- `src/bundles/retrieval-treesitter/`
- `src/bundles/embeddings/`
- `src/bundles/vectorstore-lancedb/`
- `src/bundles/retrieval-rank/`
**Done when:** a query against a real codebase returns ranked top-K context
that the agent loop from Phase 1 can consume.
**Status:** Not started

## Phase 3 — Memory + skills
**Goal:** 4-tier memory operating with scheduled compaction; procedural
tier backed by the Agent Skills format.
**Files touched:**
- `src/bundles/memory/` — hot/episodic/semantic/procedural + compaction job
- `src/bundles/skills/` — `SKILL.md` loading, progressive disclosure
**Done when:** episodic entries are written at turn end, and a compaction
run visibly promotes a repeated lesson into the hot or procedural tier.
**Status:** Not started

## Phase 4 — Orchestrator + sub-agents
**Goal:** Planner → Executor orchestration spawning scoped sub-agents.
**Files touched:**
- `src/bundles/orchestrator/`
- `src/bundles/subagent-scope/`
**Done when:** a multi-step task is decomposed and executed across at least
two sub-agents, each with distinct tool/memory scopes, all visible in the
session log.
**Status:** Not started

## Phase 5 — Sandbox providers + policy gates
**Goal:** Real execution isolation and the governance layer enforced.
**Files touched:**
- `src/bundles/sandbox-crabbox/`
- `src/bundles/sandbox-cubesandbox/`
- `src/bundles/policy-gates/`
**Done when:** the full policy table (read-only / sandbox-write /
real-fs-write / external-side-effect / deny-listed) is enforced at
`tools/pre-execute`, deny-listed actions hard-block with no override, and
every gate decision is a session-log event. `profile-coding` is complete
at the end of this phase.
**Status:** Not started

## Phase 6 — Eval harness
**Goal:** Runs can be scored and traced.
**Files touched:**
- `src/bundles/eval-runner/`
- `src/bundles/eval-langfuse/`
**Done when:** a completed run produces a pass/fail score from the custom
runner, and (optionally) exports to Langfuse.
**Status:** Not started

## Phase 7 — Browser tool (`profile-research`)
**Goal:** Sub-agents can research externally, gated by domain allowlisting.
**Files touched:**
- `src/bundles/browser/`
- `src/profiles/profile-research.yml`
**Done when:** a sub-agent completes a research task using
`vercel-labs/agent-browser`, with content-boundary markers applied to
fetched content and domain allowlisting enforced.
**Status:** Not started

## Phase 8 — Multi-user scale (`profile-full`)
**Goal:** Second sandbox provider and vector store swap for multi-user use.
**Files touched:**
- `src/bundles/vectorstore-qdrant/`
- `src/profiles/profile-full.yml` (cubesandbox as second provider, qdrant
  swapped for lancedb, eval-langfuse enabled)
**Done when:** the system runs under `profile-full` with both sandbox
providers available and Qdrant serving as the vector store.
**Status:** Not started

---
**Next:** Return to [`context.md`](../context.md).
