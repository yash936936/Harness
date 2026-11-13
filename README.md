# Coding Harness

A multi-agent orchestration harness for coding tasks, built on [Cordis](https://github.com/cordiverse/cordis). Every capability (model access, tools, retrieval, memory, sandboxing, evaluation) is a swappable plugin; profiles compose them into runnable stacks, from a single-agent kernel (`profile-minimal`) to a governed coding stack (`profile-coding`).

**Status:** working research prototype. S0 / ARCH-01 is on permanent hold under D-110. The CLI does not probe Docker, WSL, or Crabbox and never offers host command execution. Governed coding runs use file tools only. S1 is deferred, S4 is blocked under D-112, S5 distribution work is out of scope under D-115, S6 needs genuine owner-labelled sessions, and S7 still needs focused live embedding and poisoning checks. See [`docs/status.md`](docs/status.md), [`docs/AUDIT-CLOSEOUT.md`](docs/AUDIT-CLOSEOUT.md), [`docs/debug.md`](docs/debug.md), and [`docs/decisions.md`](docs/decisions.md).

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

Sandbox probing and command execution are disabled under D-110. The `code` command defaults to `--sandbox none`; the compatibility flag may be supplied explicitly, but `auto` is rejected. The CLI saves JSONL sessions in `.harness/sessions/`, asks before operations held by policy, and never falls back to host command execution. File edits remain policy-gated.

`--timeout-ms` sets the Ollama model-request timeout in milliseconds. It must be an integer from 1 to 4,294,967,295; when omitted, Ollama keeps its 120-second default. This is separate from the 120-second approval timeout. The option is Ollama-only.

OpenRouter uses environment-only credentials and per-project egress consent:

```powershell
$env:OPENROUTER_API_KEY = "<set locally; do not paste>"
$env:OPENROUTER_MODEL = "<exact free-tier model id>"
npm run harness -- code --provider openrouter --model "$env:OPENROUTER_MODEL" "Inspect the project and explain the main request flow."
```

Never put API keys in CLI arguments or files. A green test suite does not prove a live provider ran; see `docs/AUDIT-CLOSEOUT.md` and `docs/evidence/`.
