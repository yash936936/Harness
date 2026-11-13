# Product requirements

## Purpose

Harness is a research/sample coding-agent harness. It composes model access, retrieval, memory, tools, orchestration, policy gates, sandbox providers, and evaluation into a governed workflow.

## Prototype outcome

A user selects a project and submits a coding task. Harness plans the work, reads project context, proposes edits, and records an auditable session. The intended full coding workflow also runs approved development commands in a remote cloud sandbox and safely synchronizes the result.

Cloud command execution is not yet enabled. The current Vercel adapter starts an empty sandbox; it does not transfer a project or return changes.

## Required properties

- Model and tool providers are replaceable behind stable service interfaces.
- Sub-agents receive explicit, bounded tool and memory grants.
- All tool calls pass through the central registry and policy gates.
- Risky permitted writes require approval bound to an immutable operation snapshot.
- Hard-denied actions cannot be approved.
- Model-visible data and tool outcomes are recorded in the append-only session log.
- Remote model and sandbox destinations each require explicit consent and host allowlisting.
- Commands execute only in an explicitly selected remote cloud sandbox. No host or local fallback.
- Sandbox network is deny-by-default; credentials and ambient host secrets are never transferred.
- Remote results are bounded, path-validated, conflict-checked, and applied through governed writes.
- Automated tests, live provider evidence, and owner acceptance are reported separately.

## Scope exclusions

No Docker/WSL/Crabbox S0, host command execution, local command fallback, Qwen 7B artifact work, package/release distribution, desktop product, browser research, multi-user scale, or production-readiness claim.

## Evaluation

Three owner-reviewed demo sessions may support qualitative review only. Scorer output requires D-109: at least 10 distinct genuine model-driven sessions (20+ when available), owner-authored good and bad labels, and a committed label file/hash before scorer output is generated or viewed. Results are prototype-grade, not calibrated.

## Governing documents

Current scope and blockers: [STATE.md](STATE.md). Implementation sequence: [ROADMAP.md](ROADMAP.md). Agent rules: [../AGENTS.md](../AGENTS.md).
