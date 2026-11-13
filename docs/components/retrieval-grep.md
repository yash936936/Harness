# Component: retrieval-grep

> Area type: bundle. Location: `src/bundles/retrieval-grep/`. This guide describes the current implementation.

## Purpose

Provides bounded lexical search over project files. It resolves paths within a configured root, filters excluded or unsafe paths, and returns limited matching excerpts for downstream ranking and model context.

## Route (how control reaches it)

The coding profile installs the grep retriever and registers it as `ctx.retrievalGrep`. Retrieval-rank uses it to gather lexical candidates. The retrieval-tools bundle exposes the user-facing search tool through the central tool registry.

## Config surface and invariants

- The project root must be explicit and is resolved before search.
- Search depth, file count, file size, match count, and returned text are bounded.
- Paths outside the project root, symlink escapes, binary files, and excluded dependency or Git internals are not valid retrieval sources.
- Search results are evidence snippets, not executable commands or authorization grants.

## Known limits

- Lexical search does not understand code semantics or synonyms.
- Search completeness depends on configured limits and ignored paths.
- Retrieval results must be revalidated before being treated as current file content.
- See the retrieval security notes in `docs/status.md`.

---
**Next:** Return to [`context.md`](../../context.md).
