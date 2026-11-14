# Component: sandbox-vercel

> Area type: bundle. Location: `src/bundles/sandbox-vercel/`. First provider selected under D-118.

## Purpose

Implements the Vercel Sandbox adapter behind the shared `SandboxProvider` interface. It creates a fresh remote sandbox, executes argv, bounds the command lifetime and output, and attempts deletion.

## Route

A host integration must construct and register `VercelSandboxProvider` with `ctx.sandbox`. The shared sandbox service checks project-scoped remote egress consent and the exact `vercel.com` control-plane host allowlist before contacting the provider. The governed coding CLI does not register this adapter and keeps `COMMAND_TOOL` filtered.

## Config and invariants

- Target SDK: `@vercel/sandbox@3.9.1`; it is already present in the root package manifest and lockfile.
- Required host credentials are `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID`. Never pass them to the guest or log their values.
- Each lease requests `persistent: false` and `networkPolicy: 'deny-all'`.
- Commands are passed as `cmd` plus `args`; no shell command string is constructed.
- Session timeout defaults to 10 minutes; output is bounded to 100 KB per stream by default.
- Deletion is attempted in cleanup. A failed or unconfirmed delete means `released: false` and must fail the task.
- The current adapter starts an empty sandbox. It does not upload the project or collect remote changes.

## Known limits

- Workspace snapshot/upload/download, secret and sensitive-file exclusion, symlink/path defenses, transfer limits, conflict-safe result application, and lifecycle audit are incomplete.
- Profile/CLI registration is intentionally absent. Keep `COMMAND_TOOL` disabled until those controls and tests pass.
- Fake-client tests prove adapter behavior against the fake only.
- Live smoke is an empty-sandbox `true` command, not project acceptance.
- The development dependency tree previously resolved `undici@7.29.0` through `just-bash -> guarded-fetch`; the lockfile and package override now pin that nested dependency to patched `undici@7.30.2`. Re-run `npm audit` and the full CI matrix to verify the remediation.
- S4 is open, cloud-only, and not passed. See [STATE.md](../STATE.md).

<!-- BEGIN GENERATED: do not edit between markers -->

### Files and exports

| File | Exports | Responsibility (first header-comment line) |
|---|---|---|
| `src/bundles/sandbox-vercel/index.ts` | `VercelSandboxHandle`, `VercelSandboxClient`, `VercelSandboxConfig`, `VercelSandboxProvider` | Vercel Sandbox remote provider adapter. |

**Imports other areas:** `sandbox`

**Tests:** `test/sandbox-vercel.test.ts`

<!-- END GENERATED -->

---
**Next:** Return to [context.md](../../context.md).
