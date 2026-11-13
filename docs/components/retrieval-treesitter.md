# Component: retrieval-treesitter

> Area type: bundle. Location: `src/bundles/retrieval-treesitter/`. This guide describes the current implementation.

## Purpose

Provides structural parsing and chunk extraction for supported source files. It identifies syntax-aware regions so retrieval-rank can index code units rather than relying only on fixed-size text windows.

## Route (how control reaches it)

The coding profile installs the parser service as `ctx.retrievalParse`. Retrieval-rank calls it while preparing project files for indexing and retrieval. Unsupported languages or parse failures are handled as structured skips or fallback cases rather than being treated as valid syntax trees.

## Config surface and invariants

- Parser support depends on the configured Tree-sitter grammars and language mappings.
- File and parse inputs are bounded by the retrieval pipeline's size limits.
- Parsed chunks retain source path and location metadata for evidence grounding.
- A parse result does not grant permission to read outside the project root.

## Known limits

- Grammar coverage varies by language and file type.
- Parse errors and unsupported files may use non-structural fallback chunks or be skipped.
- Syntax-aware chunks still require fresh file/hash validation before being returned.
- See the retrieval-rank and retrieval-tools component guides.

---
**Next:** Return to [`context.md`](../../context.md).
