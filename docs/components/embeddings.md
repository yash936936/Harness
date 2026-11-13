# Component: embeddings

> Area type: bundle. Location: `src/bundles/embeddings/`. This guide describes the current implementation.

## Purpose

Converts text batches into vectors through one registered embedding provider. It validates input, applies configured prefixes, bounds batch and input sizes, records provider dimensions, and can normalize vectors for similarity search.

## Route (how control reaches it)

A profile or caller installs `Embeddings` as `ctx.embeddings`, then registers or configures a provider. The current provider set includes local Ollama and deterministic hashing implementations. Retrieval-rank calls `embed()` when semantic indexing or search is configured.

## Config surface and invariants

- `maxBatchSize`, `maxBatchChars`, and `maxInputChars` are positive integer limits.
- `normalize` defaults to true.
- `prefixes.document` and `prefixes.query` are optional provider-specific prefixes.
- Only one provider is active at a time because vectors from different models are not comparable.
- Registration returns a disposer so provider lifetime follows the owning plugin.
- A remote provider is refused unless a future implementation wires it through the egress gate.

## Known limits

- Hashing embeddings are useful for deterministic tests, not semantic-quality claims.
- A configured Ollama provider does not prove that a model is installed or that live embedding acceptance passed.
- Provider failures are returned as structured results so callers can fall back to lexical retrieval.
- See D-054 and the S7 evidence in `docs/status.md`.

---
**Next:** Return to [`context.md`](../../context.md).
