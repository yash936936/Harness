# Vercel Sandbox adapter status

Updated 2026-11-14. This status describes the first D-118 provider adapter, not a complete or accepted coding backend.

## Implemented

- Provider adapter behind the shared `SandboxProvider` interface.
- Non-persistent sandbox request.
- Deny-all sandbox network policy.
- argv-only command forwarding as `cmd` plus `args`.
- Independent command deadline and abort signal.
- Bounded stdout/stderr capture.
- Cleanup attempt in a `finally` path.
- Fake-client tests, including a never-resolving command and cleanup attempt.

## Not implemented

- Dependency is already declared in the root manifest/lockfile; resolve the nested Zod advisory.
- Secret-safe project snapshot creation and upload.
- Sensitive-file exclusion, symlink/path traversal defenses, and transfer size/count limits.
- Remote result collection, validation, conflict detection, and safe application.
- Provider lifecycle audit events and full redaction coverage.
- Coding profile/CLI provider selection and consent UX.
- Live credential-backed provider and end-to-end project acceptance.

## Security and CI blockers

The latest observed CI run (#613) fails at `npm audit --omit=dev --audit-level=high`. The reported vulnerable dependency is nested `zod@4.1.11` under `@vercel/cli-config@0.3.1`, pulled by the selected `@vercel/sandbox@3.9.1` tree. Do not suppress the audit or force-downgrade the SDK without verifying compatibility.

## Enablement rule

Keep `COMMAND_TOOL` filtered. Do not register the provider in the governed CLI until the existing dependency audit is green and workspace transfer, result synchronization, lifecycle audit, policy integration, and regression tests pass.

S0 remains permanently held under D-110. D-117/D-118 authorize only the separate remote cloud route. S4 remains open and not passed.
