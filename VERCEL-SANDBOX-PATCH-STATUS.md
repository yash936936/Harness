# Vercel Sandbox closeout patch status

## Implemented in this patch
- Added an independent command deadline in `src/bundles/sandbox-vercel/index.ts`.
- The deadline aborts the SDK command signal, reports `timedOut`, bounds the error text, and preserves the `finally` cleanup attempt.
- Added a regression test for a never-resolving command and confirmed lease deletion is attempted.

## Not completed / not safe to enable
- Workspace snapshot and upload/download are not implemented.
- Secret and sensitive-file filtering, symlink/path traversal defenses, size/file-count limits, and conflict-safe local result application are not implemented.
- The real `@vercel/sandbox` dependency and lockfile update are not complete. `npm install --save-exact @vercel/sandbox@3.9.1` timed out in this environment.
- No SDK-level client test using Vercel's SDK mock has been added.
- Coding CLI integration and live end-to-end acceptance remain disabled by the existing D-110 decision. Enabling them without the transfer contract would be unsafe.
- Test suite and typecheck could not be verified because dependency installation did not complete in this environment.

Do not treat this patch as a production-ready Vercel coding backend. Run `npm ci`, `npm run typecheck`, and `npx vitest run test/sandbox-vercel.test.ts` after applying it in a complete development environment.
