# Architecture

## System shape

Harness is a TypeScript application built on Cordis. Bundles register services on a shared context; profiles compose those bundles into runnable stacks.

The core path is:

`CLI → profile → orchestrator → agent loop → tool registry → policy hooks → tool → input guard → session log`

Model calls go through `ctx.llm`. Tool execution goes through `ctx.tools`. The session log records model-visible inputs, tool calls, policy decisions, approvals, and outcomes.

## Trust boundaries

- Project files, retrieval results, memory, skills, and tool output are untrusted input.
- Tool grants are checked at the registry boundary. Policy gates decide whether side effects are allowed, held for approval, or denied.
- Approvals are bound to immutable snapshots of the exact operation.
- Session-log failures block unlogged execution or result return.
- Prompt fences and pattern scans are defense-in-depth, not authorization.

## Model egress

Remote model requests require binding-level consent, project-level consent, and an allowed destination host. Provider credentials remain in private provider configuration and are never model-visible or written to session logs. Model requests and outcomes are logged with registered secrets redacted.

OpenAI-compatible cloud endpoints are supported. Ollama cloud authentication/API compatibility remains unverified. Local Ollama is a separate local provider path, not evidence of cloud acceptance.

## Cloud command execution (D-117, D-118)

Commands are authorized only inside an explicitly selected remote cloud sandbox. The first selected provider is Vercel Sandbox. No host subprocess, local execution fallback, or automatic provider detection is allowed. D-110 permanently holds the separate Docker/WSL/Crabbox S0 route.

The intended execution path is:

`tool registry → policy gates → immutable approval → sandbox service → Vercel provider → bounded result → input guard → session log`

Model-provider egress and sandbox-provider egress are separate data destinations. Each requires its own project consent and host allowlist. Traffic originating inside the sandbox is governed by a separate network policy; deny-all is the default.

### Required workspace lifecycle

1. Build a deterministic snapshot of only the selected project.
2. Exclude secrets, credential stores, sockets, and unrelated host files.
3. Reject symlink escapes and path traversal; enforce file-count and byte limits.
4. Create a short-lived, non-persistent sandbox with resource and time limits.
5. Execute argv only. Do not parse shell strings or operators.
6. Collect bounded outputs and a path-validated change manifest.
7. Detect local conflicts and apply changes only through governed approval/write paths.
8. Confirm sandbox deletion. Cleanup failure makes the task fail.

### Current provider status

The Vercel adapter exists and has fake-client lifecycle tests. It requests `persistent: false`, `networkPolicy: 'deny-all'`, passes `cmd` and `args` separately, bounds command time/output, and attempts deletion in cleanup.

It is not a complete coding sandbox: no project snapshot is uploaded, no remote changes are synchronized, provider lifecycle audit is incomplete, and the coding profile/CLI do not register it. `COMMAND_TOOL` must remain filtered. The SDK dependency is not yet integrated into the root package manifest/lockfile; the current dependency audit reports a high-severity nested Zod advisory. See [STATE.md](STATE.md).

## Current component map

| Area | Responsibility |
|---|---|
| session-log | Append-only run and audit events |
| model-adapter / egress | Model transport, consent, allowlists, redaction |
| tool-registry / policy-gates | Tool registration, grants, side-effect policy, approvals |
| tools-local | Project file operations and sandbox-backed command tool factory |
| sandbox | Provider-neutral remote execution contract and consent gate |
| sandbox-vercel | First selected cloud provider adapter |
| agent-loop / orchestrator / subagent-scope | Model loop, planning, bounded sub-agent execution |
| retrieval-* / embeddings / vectorstore | Project search and optional semantic retrieval |
| memory / skills / input-guard | Scoped context, progressive disclosure, untrusted-result fencing |
| eval-runner | Deterministic session scoring |

Component-level details are in [docs/components](components/README.md).
