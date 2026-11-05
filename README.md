# Coding Harness

A multi-agent orchestration harness for coding tasks, built on [Cordis](https://github.com/cordiverse/cordis). Every capability (model access, tools, retrieval, memory, sandboxing, evaluation) is a swappable plugin; profiles compose them into runnable stacks, from a single-agent kernel (`profile-minimal`) to a governed coding stack (`profile-coding`).

**Status:** work in progress. See [`docs/readme.md`](docs/readme.md) for what exists and is tested, [`docs/status.md`](docs/status.md) for the current state and open items, and [`docs/decisions.md`](docs/decisions.md) for why things are the way they are.

```
npm ci
npm run check        # typecheck + tests
npm run eval -- <logDir> [labels.json]   # score real session logs (Phase 6)
```

Tests that need a local Ollama or a real sandbox skip themselves when it is absent. Original project code is licensed under Apache-2.0; third-party dependencies and model weights retain their own terms (see `LICENSE`, `THIRD_PARTY_LICENSES.md`, and `docs/status.md`).
