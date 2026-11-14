# Component: session-log

> Area type: bundle. Location: `src/bundles/session-log/`. This guide describes the current implementation.

## Purpose

Persists ordered session events as JSONL and exposes append, read, replay, resume, list, and fork operations. It is the audit record for model-visible inputs, tool calls, approvals, and run outcomes.

## Route (how control reaches it)

Profiles install the service as `ctx.log`. Bundles append events through the service rather than writing session files directly. The service delegates persistence to a configured store and serializes in-process appends; file-backed stores also use cross-process locking.

## Config surface and invariants

- The configured path selects the session directory.
- Session IDs are validated before file access.
- Session file and lock paths reject symlinked parent directories as well as symlinked final files.
- Event sequence numbers are monotonic per session.
- Redactors are applied before payloads are persisted.
- Torn trailing records are handled by the file store's recovery logic; malformed interior records remain errors.
- Forking copies a bounded event prefix into a new session and leaves the source unchanged.

## Known limits

- The log is an audit trail, not a tamper-proof external ledger.
- Cross-process safety depends on the local filesystem and lock semantics.
- Redaction only covers registered secrets and configured redactors.
- See D-044 and the session-log evidence in `docs/status.md`.

---
**Next:** Return to [`context.md`](../../context.md).
