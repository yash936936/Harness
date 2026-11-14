# Component: vectorstore-lancedb

> Area type: bundle. Location: `src/bundles/vectorstore-lancedb/`. This guide describes the current implementation.

## Purpose

Implements the vector-store contract on LanceDB. It stores vector records in named collections, validates vector dimensions and metadata, supports similarity search and record maintenance, and tracks the embedding fingerprint associated with a collection.

## Route (how control reaches it)

A profile or host installs the LanceDB adapter as `ctx.vectorstore`. Retrieval-rank uses the shared vector-store interface when semantic indexing is configured. Callers open a named collection with a fingerprint and dimension count, then use the returned collection methods.

## Config surface and invariants

- Collection names are limited to 1-64 letters, digits, underscore, and hyphen.
- IDs, source strings, metadata, result counts, and vector dimensions have explicit upper bounds.
- Vectors must have the collection's dimension count, finite values, and at least one non-zero value.
- Writes are serialized in call order and validate a full batch before mutating storage.
- Collection metadata records the embedding fingerprint, dimensions, and optional feature/project owner. An owned collection cannot be opened or reset by a different owner. Legacy unowned collections require an explicit reset before an owner can claim them.
- Closed collections return structured failures.

## Known limits

- Collection opens are serialized within a store instance. Ownership is persisted in table metadata; cross-feature resets are refused even with `reset: true`. Legacy unowned collections need an explicit reset before a feature can claim them.

- LanceDB is an optional semantic index, not the source of truth for project files.
- Indexed records can become stale; retrieval-rank must validate current file hashes before returning content.
- Storage success does not prove embedding quality or live retrieval acceptance.
- See the S7 embedding status in `docs/status.md`.

---
**Next:** Return to [`context.md`](../../context.md).
