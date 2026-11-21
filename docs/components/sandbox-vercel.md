# Component: sandbox-vercel

> Area type: bundle. Location: `src/bundles/sandbox-vercel/`. First provider selected under D-118.

## Purpose

Implements the one-shot Vercel Sandbox command adapter and a persistent, task-scoped workspace session provider. The workspace provider runs guest commands as a dedicated unprivileged Linux user and checks durable capability scope and lease fencing before remote execution.
## Route

A host integration registers `VercelSandboxProvider` with `ctx.sandbox` for one-shot commands. Task workspaces use `VercelWorkspaceSessionProvider` through `WorkspaceRuntime`, sharing the project's `SQLiteLeaseStore` and `SQLiteWorkspaceStore`. Both remote paths require project-scoped egress consent and the exact `vercel.com` host allowlist. The governed coding CLI does not register either provider and keeps `COMMAND_TOOL` filtered.
## Config and invariants

- Target SDK: `@vercel/sandbox@3.9.1`; it is present in the root package manifest and lockfile.
- Required host credentials are `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID`. They stay in the host process and are never passed to guest commands.
- The one-shot provider requests `persistent: false`; task workspaces request `persistent: true`. Both use `networkPolicy: 'deny-all'`.
- The workspace provider requires a project-matched egress status with consent and calls `assertAllowedHost('vercel.com')` before remote create/get/delete operations.
- Task workspaces use a dedicated `harness` Linux user, persistent sandbox tags containing a SHA-256 scope digest, and a private home directory. Commands use argv and a canonical workspace-relative cwd; realpath must remain under the workspace root.
- Provider execution rechecks the SQLite capability token, operation, path prefix, expiry, session binding, and current lease fencing token. Registered egress secrets are redacted from returned command output. Raw capability tokens are not sent to Vercel or persisted in plaintext.
- Workspace command output has one combined byte cap. Persistent sandbox snapshots retain only the latest snapshot; confirmed close requests delete orphan snapshots.
- The one-shot adapter starts an empty sandbox. The workspace session provider does not yet implement snapshot byte transfer or governed result application.
## Known limits

- `VercelWorkspaceSessionProvider` implements task-scoped session lifecycle and fenced command execution only. It does not yet implement `WorkspaceTransferProvider`, bounded file-byte upload/collection, source enumeration, deterministic snapshot application, conflict detection, or atomic result synchronization.
- Restart adoption after lease expiry and provider-validated recovery are not implemented. A remote sandbox can be reattached by name only when the durable session and current lease still validate.
- The dedicated Linux user and private home provide task-level isolation inside the Vercel microVM; they are not a chroot or a per-path OS sandbox. Command capabilities constrain the working directory but do not constrain arbitrary file paths used by the command itself.
- Fake-client tests verify adapter decisions only. No live Vercel sandbox acceptance has been run; live SDK buffering, remote lifecycle, network policy, and process termination still require authorized cloud acceptance.
- Profile/CLI registration is intentionally absent. Keep `COMMAND_TOOL` disabled until secure transfer, conflict-safe sync, provider recovery, and policy integration pass.
- The one-shot adapter's existing output-capture tests do not establish live SDK internal buffering or remote process-tree termination. Stale draft PR #123 was closed as superseded.
- Root package overrides pin `@vercel/cli-config`'s nested Zod to 4.6.7 and `guarded-fetch`'s nested undici to 7.30.2. Current dependency-audit status is established by main CI, not the historical audit-branch report.
- S4 remains open and cloud-only. See [STATE.md](../STATE.md).
<!-- BEGIN GENERATED: do not edit between markers -->

### Files and exports

| File | Exports | Responsibility (first header-comment line) |
|---|---|---|
| `src/bundles/sandbox-vercel/index.ts` | `VercelSandboxCommand`, `VercelSandboxHandle`, `VercelSandboxClient`, `VercelSandboxConfig`, `VercelSandboxProvider` | Vercel Sandbox remote provider adapter. |
| `src/bundles/sandbox-vercel/workspace.ts` | `VercelWorkspaceCommand`, `VercelWorkspaceUser`, `VercelWorkspaceSandbox`, `VercelWorkspaceClient`, `VercelWorkspaceEgressGate`, `VercelWorkspaceProviderOptions`, `VercelWorkspaceSessionProvider` | Persistent, task-scoped Vercel Sandbox workspace session provider. |

**Imports other areas:** `architecture`, `sandbox`

**Tests:** `test/sandbox-vercel-workspace.test.ts`, `test/sandbox-vercel.test.ts`

<!-- END GENERATED -->

---
**Next:** Return to [context.md](../../context.md).
