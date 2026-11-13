## D-118 — Vercel Sandbox selected as first cloud provider — 2026-11-13

**Decision:** Use Vercel Sandbox as the first provider for the cloud-only command execution direction approved by D-117. Keep the Harness provider interface provider-neutral.

**Required boundary:** Use non-persistent sandboxes, deny-all sandbox network policy by default, argv-only command invocation, bounded resources/time/output, and confirmed cleanup. The sandbox provider requires its own project consent and exact host allowlist, separate from model-provider consent.

**Not authorized by this selection:** Do not enable the governed CLI command tool yet. The current adapter starts an empty sandbox and does not transfer the project workspace or synchronize remote changes. Keep `COMMAND_TOOL` filtered until secret-safe workspace transfer, conflict-safe result synchronization, provider lifecycle audit, and policy integration are implemented and tested.

**Acceptance:** Fake-client tests are not live provider acceptance. S4 remains open until an owner-run project workflow proves snapshot transfer, governed command execution, safe result collection, secret exclusion, and verified cleanup.

**Affects:** `docs/STATE.md`, `docs/ROADMAP.md`, `docs/BUILD-PLAN.md`, `docs/components/sandbox-vercel.md`. No claim of live Vercel acceptance is made.

## D-117 — Cloud-only command execution and cloud model testing — 2026-11-13

**Decision:** Authorize full development command execution only inside an explicitly selected remote cloud sandbox. Cloud-hosted model inference is the target for model-driven testing. No host command execution, local subprocess fallback, or automatic local sandbox selection is permitted.

**Command scope:** Project inspection/search, dependency installation, builds, tests, and approved Git operations. All operations remain subject to existing policy gates, risk classification, immutable approval snapshots, hard denials, argv-only invocation, resource/time/output limits, and verified lease cleanup.

**Independent data destinations:** Model-provider egress and sandbox-provider egress are separate. Each requires explicit project consent and host allowlisting. Sandbox network access is disabled by default and requires a separate explicit policy for any permitted registry access. Do not transfer host credentials, model API keys, SSH agents, or credential stores into the sandbox.

**Supersedes:** D-116 D1 and D2 only where they prohibit cloud command execution or cloud-hosted model testing. D-116 D3 and D-109 remain unchanged. D-110 remains unchanged for Docker/WSL/Crabbox and host execution; S0 stays PERMANENT-HOLD and S1 stays deferred. S4 is reopened only as a cloud-only acceptance plan and is not passed. D-115 remains unchanged.

**Affects:** `docs/STATE.md`, `docs/ROADMAP.md`, `docs/BUILD-PLAN.md`, `docs/architecture.md`, and current CLI/provider guides. This decision authorizes implementation, not an assertion that it is complete.

