# PRD — Coding Harness

## Problem
Coding-focused agent work (research, retrieval, multi-step edits, tool use)
needs an orchestration layer that is reliable, auditable, and extensible —
not a single hardcoded agent loop. Off-the-shelf harnesses are either
Python-centric, not composable at the capability level, or don't separate
"what the model is allowed to do" from "what the model can see," which makes
governance an afterthought instead of a structural property.

## Goals
- A multi-agent orchestration system where every capability (model access,
  tools, retrieval, memory, sandbox, browser) is a swappable plugin.
- Sub-agents scoped to specific task types, each with their own tool/memory
  permissions, without a separate codebase per agent type.
- A retrieval pipeline (grep → tree-sitter → rank → top-K → LLM) that starts
  as classical RAG and can grow into graph/agentic RAG later.
- A 4-tier memory model (hot/episodic/semantic/procedural) that improves via
  scheduled compaction rather than just accumulating.
- Governance built in from day one: policy gates, confidence-scored
  approval flow, and an append-only session log as the audit trail.
- A personal browser tool sub-agents can use for research, gated by domain
  allowlisting.

## Non-goals
- Not a general-purpose no-code agent builder (ruled out `langflow-ai/langflow`
  explicitly — wrong audience).
- Not an email/inbox agent (ruled out `cloudflare/agentic-inbox`).
- Not a social-media/web-scraping capability layer (ruled out
  `Panniantong/Agent-Reach` — wrong domain).
- Not committing to a Python runtime — Cordis/TypeScript is the chosen stack;
  Python reference repos are read for ideas only, not adopted as dependencies.
- Not building a local embedding/model-hosting stack for v1 — API providers
  only (OpenAI/Anthropic/Voyage), swappable later.

## Users / use cases
- The project owner, using this harness to run coding-agent workflows (via
  opencode) that need multi-step planning, code search, sandboxed execution,
  and persistent memory across sessions.
- Core scenarios: "find and fix a bug across a codebase," "implement a
  feature using retrieved context from tree-sitter-ranked files," "run a
  sandboxed test/build without touching the real filesystem until approved,"
  "research something externally via a gated browser tool."

## Success criteria
- `profile-minimal` runs a single agent end-to-end with a working session
  log, model adapter, tool registry, subprocess execution, and ReAct loop.
- `profile-coding` adds retrieval, memory, skills, orchestration, and
  sub-agents without touching `profile-minimal`'s bundles.
- Every model-visible event is a logged session-log event (the
  "model-visible = logged" invariant holds, verifiable by inspecting the
  log after any run).
- The policy table (read-only / sandbox-write / real-fs-write / external
  side-effect / deny-listed) is enforced at `tools/pre-execute`, not
  bypassable by a sub-agent flipping a runtime toggle.
- Guardrails are disableable only in `profile-minimal`; `profile-coding` and
  above cannot run with `policy-gates` off.

## Constraints
- Stack constraint: Cordis-based (TypeScript), not Python — explicit
  decision, see `docs/decisions.md` D-001.
- deepseek-harness's own `packages/` are a reference to study, not a runtime
  dependency (it's labeled developer-preview with breaking changes expected).
- q-agent-harness contributes its memory model and Map/Guardrails/Feedback
  framing only — its code/templates are not adopted.
- Coding agent for implementation: opencode (per project setup).

---
**Next:** Return to [`context.md`](../context.md).
