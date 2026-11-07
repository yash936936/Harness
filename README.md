# Coding Harness

A multi-agent orchestration harness for coding tasks, built on [Cordis](https://github.com/cordiverse/cordis). Every capability (model access, tools, retrieval, memory, sandboxing, evaluation) is a swappable plugin; profiles compose them into runnable stacks, from a single-agent kernel (`profile-minimal`) to a governed coding stack (`profile-coding`).

**Status:** working prototype, still under audit. See [`docs/readme.md`](docs/readme.md) for implemented capabilities, [`docs/status.md`](docs/status.md) for acceptance gates, [`docs/AUDIT-CLOSEOUT.md`](docs/AUDIT-CLOSEOUT.md) for evidence, [`docs/debug.md`](docs/debug.md) for defect history, and [`docs/decisions.md`](docs/decisions.md) for locked decisions.

```
npm ci
npm run check        # typecheck + tests
npm run eval -- <logDir> <committed-labels.json> [checkCommandRegex]   # D-109 labels required before scoring
```

Tests that need a local Ollama or a real sandbox skip themselves when it is absent. Original project code is licensed under Apache-2.0; third-party dependencies and model weights retain their own terms (see `LICENSE`, `THIRD_PARTY_LICENSES.md`, and `docs/status.md`).

## Governed coding prototype

Use the orchestrated, policy-gated path (separate from legacy single-call `run`):

```powershell
npm ci
npm run harness -- code --provider ollama --model <installed-model-tag> [--timeout-ms 300000] "Inspect the project and explain the main request flow."
```

`--timeout-ms` sets the Ollama model-request timeout in milliseconds. It must be an integer from 1 to 4,294,967,295; when omitted, Ollama keeps its 120-second default. This is separate from the 120-second approval timeout. The option is Ollama-only.

It uses the current directory as project root, saves JSONL sessions in `.harness/sessions/`, and asks before operations held by policy. With Docker and Crabbox ready it uses Crabbox local-container. Otherwise it prints `no sandbox: commands disabled, file tools still gated`; it never falls back to host command execution. File edits remain policy-gated.

OpenRouter uses environment-only credentials and per-project egress consent:

```powershell
$env:OPENROUTER_API_KEY = "<set locally; do not paste>"
$env:OPENROUTER_MODEL = "<exact free-tier model id>"
npm run harness -- code --provider openrouter --model "$env:OPENROUTER_MODEL" "Inspect the project and explain the main request flow."
```

Never put API keys in CLI arguments or files. A green test suite does not prove Docker, Crabbox or a live provider ran; see `docs/AUDIT-CLOSEOUT.md` and `docs/evidence/`.
