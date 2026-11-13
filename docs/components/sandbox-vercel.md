# Component: sandbox-vercel

> Area type: bundle. Location: `src/bundles/sandbox-vercel/`. This guide describes the first D-117 cloud provider adapter.

## Purpose

Implements the Vercel Sandbox provider behind the shared `SandboxProvider` interface. It creates a fresh remote Firecracker sandbox, runs one argv command with network access disabled, and deletes the sandbox before returning.

## Route (how control reaches it)

A host integration constructs and registers `VercelSandboxProvider` with `ctx.sandbox`. The shared sandbox service checks project-scoped remote egress consent and the exact `vercel.com` host allowlist before calling the provider. The governed coding CLI does not register this adapter yet and continues to filter `COMMAND_TOOL`.

## Config surface and invariants

- Runtime SDK: `@vercel/sandbox@3.9.1`, loaded lazily. It is not yet in package.json/package-lock.json.
- Host credentials: `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID`. Values are never passed to the guest or logged.
- Each lease uses `persistent: false` and `networkPolicy: 'deny-all'`.
- Commands are passed as `cmd` plus `args`; no shell string is constructed.
- Session timeout defaults to 10 minutes. Output is bounded to 100 KB per stream by default.
- Cleanup uses `delete()`. A failed delete returns `released: false` and must be treated as a failed command.
- The project snapshot/result-sync boundary is not implemented. This adapter currently runs in an empty sandbox and must not be exposed as project command execution.

## Known limits

- No profile-coding or CLI registration. `COMMAND_TOOL` remains disabled until secret-safe workspace transfer, Git metadata handling, safe result synchronization and lifecycle audit events are implemented.
- Fake-client tests are not live Vercel acceptance.
- Live provider smoke requires an explicit `HARNESS_VERCEL_SANDBOX_LIVE=1` opt-in and host credentials. It runs only `true` in an empty sandbox.
- Vercel Hobby sessions have a 45-minute maximum; the adapter default is shorter. S4 remains NOT PASSED.
- See D-117, D-118, and `docs/STATE.md`.

<!-- BEGIN GENERATED: do not edit between markers -->

### Files and exports

| File | Exports | Responsibility (first header-comment line) |
|---|---|---|
| `src/bundles/sandbox-vercel/index.ts` | `VercelSandboxHandle`, `VercelSandboxClient`, `VercelSandboxConfig`, `VercelSandboxProvider` | Vercel Sandbox remote provider adapter. |

**Imports other areas:** `sandbox`

**Tests:** `test/sandbox-vercel.test.ts`

<!-- END GENERATED -->

---
**Next:** Return to [`context.md`](../../context.md).
