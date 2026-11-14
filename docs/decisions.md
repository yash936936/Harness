## D-119 — Architecture decisions for shared state, memory, and task workspaces — 2026-11-14

**Approved architecture decisions:**

1. **Shared state: SQLite.** Use SQLite as the first transactional coordination backend for cross-process budgets, rate limits, reservations, leases, and related metadata. Keep a storage interface so another backend can be added later. SQLite must use a supported local filesystem; do not claim multi-machine shared-state support or use arbitrary network filesystems.
2. **Sandbox workspace API: capability-based sessions.** Add task-scoped workspace sessions and narrowly scoped capabilities alongside the existing one-shot sandbox API. Preserve existing provider contracts. Capabilities bind to task, session, allowed operations, filesystem scope, expiry, and revocation. Workspace transfer and result synchronization must be validated and fail closed.
3. **Memory retention: hybrid.** Keep durable append-only history separate from bounded searchable memory. Durable history remains the source of truth subject to an explicit retention/deletion policy. Searchable facts, episodes, summaries, and vector indexes are bounded, paginated, and rebuildable.
4. **Backward compatibility: preserve.** Preserve public APIs, existing provider implementations, persisted formats, and caller-visible behavior where possible. Introduce adapters and migrate internals incrementally. Do not use dual writes without a defined reconciliation protocol.

**Still to confirm before implementation:** deployment topology (single host or multi-machine); database ownership (one database per project or a shared database with project isolation); durable-history retention/deletion policy; and whether a crashed workspace may be resumed by another process. These are not approved decisions yet.

**Provisional planning defaults only:** design SQLite for multiple local processes on a supported local filesystem; use one database per project; do not automatically delete durable history; resume a crashed workspace only with explicit lease ownership and validated provider recovery. Revisit these defaults when the four open questions are answered.

**Migration order:** architecture contracts; SQLite foundation and transactional budget/rate-limit coordination; memory append/query/index/retention improvements; capability-based workspace sessions and leases; streaming output limits; cross-subsystem failure and compatibility testing.

**Acceptance:** Multi-process tests must use independent processes. Workspace tests must cover cross-task isolation, least privilege, revocation, path escape, interrupted transfer, cancellation, and cleanup. Memory tests must prove bounded reads, writes, and reindexing. Existing API and provider contract tests must continue to pass.

**Scope boundary:** This decision does not authorize enabling `run_command` in the coding profile. D-110, D-117, and D-118 remain in force. No Docker, WSL, Crabbox, host command fallback, or live sandbox acceptance is authorized by this architecture decision.

**Affects:** `docs/STATE.md`, `docs/ROADMAP.md`, `docs/CODEBASE-AUDIT-CHECKLIST.md`, storage, memory, sandbox, and profile architecture.

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

