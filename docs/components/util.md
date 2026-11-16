# Component: util

> Area type: support. Location: `src/util/`. This guide describes the current shared utility module.

## Purpose

Provides cross-process file-locking helpers and the file-backed SQLite transaction/migration foundation used for small shared coordination state.

## Route (how control reaches it)

Persistent store implementations import `withFileLock()` from `src/util/filelock.ts` and wrap read-modify-write operations. `SQLiteDatabase` in `src/util/sqlite.ts` uses sql.js WebAssembly, reloads the database under that lock, runs a transaction, and atomically replaces the file. The utility is not registered as a Cordis service.

## Config surface and invariants

- `timeoutMs` bounds how long a caller waits for a lock.
- `staleMs` controls when an empty or partial lock without a usable PID may be treated as abandoned.
- A lock with a live owner PID is not broken based on age.
- Lock creation is exclusive and release verifies the caller's random ownership token.
- Lock timeout is an explicit error; callers must not silently proceed without the lock.
- SQLite migrations are ordered and checksummed. Stale plans and ledger drift fail closed.
- SQLite writes serialize across local processes and replace the database atomically. The current implementation reloads and exports the full database per write, so use it only for bounded coordination metadata.

## Known limits

- Locks are advisory and protect only callers that use the same lock protocol.
- PID liveness assumes one machine and a local filesystem.
- A narrow cross-process TOCTOU window remains because portable Node APIs lack atomic compare-and-unlink.
- SQLite domain stores for budgets, rate limits, and leases are not integrated yet. This foundation does not establish cross-process budget correctness.
- See BUG-07 and BUG-09 in the source comments and tests.

---
**Next:** Return to [`context.md`](../../context.md).
