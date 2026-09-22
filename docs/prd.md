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
- A working path for people without strong hardware: a cloud worker through
  any OpenAI-compatible provider, with free options where they exist, and an
  optional local worker for those who have the hardware (D-021).
- Plain, accurate statements about data: the harness collects nothing itself,
  and a cloud provider or remote sandbox receives what it is given (D-020).
- A first-run experience (terminal wizard, then a desktop app) that connects
  a provider, asks for consent, sets a budget and shows where data goes
  (D-025).

## Non-goals
- Not a general-purpose no-code agent builder (ruled out `langflow-ai/langflow`
  explicitly — wrong audience).
- Not an email/inbox agent (ruled out `cloudflare/agentic-inbox`).
- Not a social-media/web-scraping capability layer (ruled out
  `Panniantong/Agent-Reach` — wrong domain).
- Not committing to a Python runtime — Cordis/TypeScript is the chosen stack;
  Python reference repos are read for ideas only, not adopted as dependencies.
- Not building a model-hosting stack. Local workers are optional through
  Ollama; the harness does not ship or serve a worker model of its own.
- Not claiming to be offline or to send no data (D-020).

## Users / use cases
- The project owner, using this harness to run coding-agent workflows that
  need multi-step planning, code search, sandboxed execution, and persistent
  memory across sessions. Later, other people on ordinary hardware (8 GB, no
  GPU) who connect a cloud provider.
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
- Tool gating (`policy-gates`) is disableable only in `profile-minimal`;
  `profile-coding` and above cannot run with it off. Egress controls cannot be
  disabled in any profile (D-029).
- A remote provider is never called without consent, and every remote call
  is logged with destination and size.
- On a free provider tier the harness stays inside the provider's request
  limits and reports what it can still do when a limit is reached.

## Constraints
- Stack constraint: Cordis-based (TypeScript), not Python — explicit
  decision, see `docs/decisions.md` D-001.
- deepseek-harness's own `packages/` are a reference to study, not a runtime
  dependency (it's labeled developer-preview with breaking changes expected).
- q-agent-harness contributes its memory model and Map/Guardrails/Feedback
  framing only — its code/templates are not adopted.
- Implementation: currently Claude writes and verifies the code (Claude-only
  mode); opencode is suspended until the owner says otherwise.
- Test machine: 8 GB RAM, no GPU. Free provider tiers only for now.

---
**Next:** Return to [`context.md`](../context.md).
