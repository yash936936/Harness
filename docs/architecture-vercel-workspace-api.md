# Vercel workspace provider API verification

Verified against the published Vercel Sandbox TypeScript SDK documentation and the `@vercel/sandbox` source tag `@vercel/sandbox@3.9.1` on 2026-11-23. This is source/type-surface inspection, not a live Vercel acceptance run.

## Confirmed SDK operations

The current provider abstraction is narrower than the documented SDK surface. The TypeScript SDK documentation describes:

- `Sandbox.get({ name, resume: false })` for non-resuming inspection and `Sandbox.get({ name, resume: true })` for reattachment.
- `sandbox.tags` for reading metadata and `sandbox.update({ tags })` for replacing the complete tag set. A recovery update must preserve all existing required tags and must not occur until the old lease is expired and a new fenced owner is durably established.
- `sandbox.fs.readdir(path, { withFileTypes: true })`, `lstat`, `stat`, and `realpath` for traversal and filesystem classification. Symlinks and non-regular file types must be rejected before reading content.
- `sandbox.asUser('harness').readFile({ path })` returns a Node readable stream at the API boundary, but in SDK 3.9.1 its implementation calls `catAsUser()` to materialize the entire file as a `Buffer`, then wraps that buffer with `Readable.from([buffer])`. It is not bounded-memory streaming and must not be used for large-file transfer. `sandbox.fs.readFile` also returns a fully materialized `Buffer` or string.
- `sandbox.asUser('harness').writeFiles([{ path, content: Uint8Array }])` accepts byte arrays and writes them through the SDK HTTP API, then adjusts ownership. Keep each submitted byte array at or below the configured transfer chunk size. The SDK does not expose a general writable streaming handle. Appending chunks with a guest command is possible but needs a private staging directory, strict path checks, size/hash verification, and crash-safe cleanup.
- `sandbox.snapshot()` returns a `Snapshot` object with `snapshotId`, `status`, and expiry metadata. `sandbox.listSnapshots()` returns a paginated async iterable. `Sandbox.create({ source: { type: 'snapshot', snapshotId } })` restores a snapshot. The Harness adapter currently narrows the snapshot result to status only, so it must be extended before a durable Harness-manifest-to-Vercel-snapshot mapping can be implemented.

Official references:
- https://vercel.com/docs/sandbox/sdk-reference
- https://vercel.com/docs/sandbox/concepts/tags
- https://vercel.com/docs/sandbox/concepts/snapshots
- https://vercel.com/docs/sandbox/examples/snapshot-and-restore

## Required implementation boundaries

### Recovery and fencing

Recovery is a durable ownership transition, not merely a call to `Sandbox.get`. The implementation must:

1. Read the SQLite session and prove the prior lease expired.
2. Acquire a new lease with a strictly higher fencing token.
3. Ask the provider to inspect the named sandbox without resuming it.
4. Validate the provider identity, project scope, workspace ID, current tags, and a recovery proof tied to the prior durable session.
5. Persist the new session owner and fence using the existing compare-and-set adoption transaction, revoking old capabilities.
6. Replace the full remote tag set with the new scope digest, re-read the sandbox, and verify the new tags before resuming.
7. Reassert deny-all networking before any guest operation.
8. On any uncertain partial update, mark the session unknown/failed and reconcile from fresh provider metadata. Never let the old fence execute.

The provider now exposes `recover` and rotates owner/lease/fence tags before SQLite adoption. Fake-client tests cover lease expiry, fence advancement, old-capability revocation, and reattachment. Follow-up hardening in PR #204 binds recovery to the exact durable session record and rejects terminal/closing states before remote access. These tests do not establish live Vercel behavior or credential/egress acceptance.

### Transfer

The SDK has the filesystem primitives needed for provider-backed enumeration and transfer, but the current `VercelWorkspaceSessionProvider` exposes only `realpath` in its adapter type and does not implement `WorkspaceTransferProvider`.

The adapter must use Dirent/lstat checks to reject symlinks and special files, canonicalize every path, apply the existing secret-path policy before reading, enforce manifest and byte quotas before allocation, and stream file reads in bounded chunks while hashing. Do not mistake `SandboxUser.readFile()` for streaming: in SDK 3.9.1 it buffers the complete file before returning its readable wrapper. A bounded reader must instead use a guest process with a byte-preserving encoding and consume command log chunks incrementally, with strict output/timeout limits, or use a separately verified streaming API. Upload must consume only manifest-approved paths, validate the complete stream before commit, write into a staging area, verify remote size/hash, and publish with a conflict-safe atomic rename strategy. The SDK docs' append/write methods alone do not prove a multi-file atomic commit; that behavior needs a separate staging protocol and failure recovery.

The transfer contract also needs durable snapshot-to-manifest metadata. A remote Vercel snapshot ID cannot be treated as the Harness manifest ID unless the association is persisted and revalidated after process restart.

### Phase 3 performance and recovery

Provider API work does not close Phase 3. Required evidence remains separate: large-file retrieval peak memory, deletion-heavy large stores, concurrent writers, cursor invalidation, interrupted/restarted reindexing, and reproducible p50/p95 measurements. Existing process-wide sampled RSS is not a per-operation peak-memory measurement.

## Acceptance status

| Workstream | Evidence in repository | Still required |
|---|---|---|
| Phase 3 recovery and scaling | Existing torn-append, cross-process and 100k-event tests/benchmarks | Large-file peak memory, additional scale/concurrency/reindex restart tests and refreshed reproducible evidence |
| Phase 4 recovery | Provider-validated recovery saga, remote tag rotation, SQLite adoption, fake-client restart/retry coverage | Live Vercel acceptance, reconciliation after uncertain remote tag/snapshot failures |
| Secure transfer | Manifest/path/secret/stream validators and hard quotas; SDK 3.9.1 source review | Provider enumeration, no-follow type checks, genuinely bounded remote reads/writes, durable snapshot mapping, staging, conflict-safe apply and interrupted-transfer recovery |
| Live acceptance | Fake-client lifecycle coverage | Owner-authorized Vercel credentials/egress and live acceptance run |

Do not mark transfer complete until the exact pinned SDK surface is compiled and exercised, all remote operations have bounded memory and crash-safe semantics, the full CI matrix passes, and live provider acceptance is explicitly authorized and recorded.
