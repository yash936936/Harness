# Coding Harness: developer guide

Harness is a TypeScript/Cordis research prototype for governed multi-agent coding workflows. This guide describes the current repository state, not the full product vision.

## Current status

The core includes model adapters, a tool registry, policy gates, project file tools, retrieval, memory, orchestration, session logging, and evaluation. The governed CLI supports policy-gated file operations.

Cloud command execution is **not enabled**. D-117 authorizes remote cloud sandbox execution only, and D-118 selects Vercel Sandbox as the first provider. The adapter is present and fake-client tested, but it currently runs in an empty sandbox. Workspace transfer, safe result synchronization, lifecycle audit, CLI/profile registration, and live acceptance remain open. Never substitute host execution.

## Setup

```sh
npm ci
npm run check
npm run docs:check
```

Use Node versions allowed by `package.json` and CI. Keep PowerShell commands on separate lines when using Windows PowerShell 5.1.

## Model providers

The OpenAI-compatible adapter supports cloud endpoints such as OpenRouter. Set API credentials through environment variables, never CLI arguments or committed files. Remote model calls require the model egress consent and host allowlist.

Ollama is available as a local provider. Ollama cloud authentication/API compatibility is not accepted until separately verified. Model-provider egress is independent of sandbox-provider egress.

## Sandbox and command execution

- D-110 permanently holds Docker/WSL/Crabbox S0. Do not probe or retry them.
- Vercel Sandbox is the selected first cloud provider.
- Sandbox network access defaults to deny-all.
- Commands must use argv, not implicit shell parsing.
- Do not expose `COMMAND_TOOL` until secret-safe workspace transfer, conflict-safe result synchronization, lifecycle audit, and policy integration pass.
- No host subprocess or local fallback is allowed.

## Evaluation

Three demo sessions are qualitative only. Scorer output follows D-109: at least 10 distinct genuine model-driven sessions (20+ when available), both good and bad owner labels, and the labels file plus hash committed before scorer output is generated or viewed. Report results as prototype-grade, not calibrated.

## Current plan

See [STATE.md](STATE.md), [BUILD-PLAN.md](BUILD-PLAN.md), and [ROADMAP.md](ROADMAP.md). Historical phase notes are in [phases.md](phases.md); they are not the active execution plan.
