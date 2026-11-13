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

- Dependency is declared in the root manifest/lockfile; a scoped override pins nested Zod to 4.6.7 and the audit branch CI dependency check passes.
- Secret-safe project snapshot creation and upload.
- Sensitive-file exclusion, symlink/path traversal defenses, and transfer size/count limits.
- Remote result collection, validation, conflict detection, and safe application.
- Provider lifecycle audit events and full redaction coverage.
- Coding profile/CLI provider selection and consent UX.
- Live credential-backed provider and end-to-end project acceptance.

## Security and CI blockers

Audit branch CI run 43516548037 passed `npm audit --omit=dev --audit-level=high` with the nested Zod override. This verifies dependency audit only; it does not prove live Vercel execution. Main remains unchanged until PR #92 merges.

## Enablement rule

Keep `COMMAND_TOOL` filtered. Do not register the provider in the governed CLI until the existing dependency audit is green and workspace transfer, result synchronization, lifecycle audit, policy integration, and regression tests pass.

S0 remains permanently held under D-110. D-117/D-118 authorize only the separate remote cloud route. S4 remains open and not passed.
