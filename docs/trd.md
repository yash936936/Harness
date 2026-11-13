# Technical requirements

## Runtime and composition

- TypeScript on Node.js, using Cordis for service and plugin composition.
- `profile-minimal` provides the core model/tool/session loop.
- `profile-coding` adds project file tools, retrieval, memory, skills, policy gates, orchestration, and evaluation.
- Keep component boundaries provider-neutral where a stable interface already exists.

## Model providers

- Model access is exposed through `ctx.llm`.
- OpenAI-compatible endpoints such as OpenRouter are supported.
- Local Ollama is supported. Ollama cloud API-key/auth compatibility is not accepted until verified.
- Remote model calls require explicit model egress consent and host allowlisting.
- Credentials stay in private provider configuration and must not enter prompts, logs, or sandbox environments.

## Tool and policy path

- Every tool call passes through `ctx.tools`.
- Validate schema and caller grants before execution.
- Apply policy classification, immutable approval snapshots, hard denials, output bounds, and session logging.
- Missing policy or audit infrastructure fails closed.
- Treat model-visible file, memory, retrieval, skill, and tool content as untrusted data.

## Command execution

- D-117 permits development commands only in an explicitly selected remote cloud sandbox.
- D-118 selects Vercel Sandbox as the first provider.
- Never use host subprocess, local sandbox, auto-detection, or fallback.
- Invoke argv only; no implicit shell parsing.
- Use a non-persistent workspace with bounded resources, time, process count, disk, and output.
- Sandbox network is deny-all unless a separate allowlist policy explicitly permits destinations.
- Do not transfer host credentials, model keys, SSH agents, sockets, or credential stores.
- Snapshot only the selected project; exclude secrets and reject path/symlink escapes.
- Validate remote results and detect conflicts before applying changes through governed writes.
- Confirm deletion; cleanup failure is a failed task.

## Acceptance and operations

- CI must pass typecheck, lint, tests, documentation checks, dependency/security checks, and aggregate `ci-pass`.
- Fake-backed tests do not establish live provider behavior.
- Live cloud acceptance requires owner-run evidence for workspace transfer, commands, result synchronization, policy cases, secret exclusion, and cleanup.
- S6 follows D-109. Three qualitative sessions do not produce scorer metrics.
- D-115 excludes packaging, release, hosted distribution, and model-weight distribution.

Current implementation status and sequence: [STATE.md](STATE.md) and [ROADMAP.md](ROADMAP.md).
