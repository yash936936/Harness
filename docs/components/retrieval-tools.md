# Component: retrieval-tools

> Area type: bundle. Location: `src/bundles/retrieval-tools/`. This guide describes the current implementation.

## Purpose

Exposes project retrieval operations as model-callable tools. It connects the lexical and structural retrievers to the tool-registry enforcement boundary and formats bounded results for model consumption.

## Route (how control reaches it)

The coding profile installs retrieval-tools after the retrieval services and tool registry. It registers tools such as `search_code` through `ctx.tools`. Agent-loop calls them only through the registry, where grants, policy hooks, result scanning, and logging apply.

## Config surface and invariants

- The configured project root and retrieval service instances must agree.
- Query and result sizes are bounded before they reach the model.
- Returned snippets are untrusted project data and must remain fenced.
- Tool registration does not grant access beyond the caller's `allowedTools` set.
- Retrieval failure does not authorize a fallback to unrestricted filesystem access.

## Known limits

- Search tools provide excerpts, not a complete or guaranteed index of the repository.
- The model must not treat retrieved text as instructions.
- File tools remain the authoritative path for bounded reads and current content.
- See D-083 and the retrieval component guides.

---
**Next:** Return to [`context.md`](../../context.md).
