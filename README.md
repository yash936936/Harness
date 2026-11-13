# Coding Harness

A multi-agent orchestration harness for coding tasks, built on [Cordis](https://github.com/cordiverse/cordis). Every capability (model access, tools, retrieval, memory, sandboxing, evaluation) is a swappable plugin; profiles compose them into runnable stacks, from a single-agent kernel (`profile-minimal`) to a governed coding stack (`profile-coding`).

**Status (2026-11-13):** sample/research prototype. D-117 authorizes full development command execution only inside a remote cloud sandbox and cloud-hosted model testing. No host execution or local fallback. D-110 still holds Docker/WSL/Crabbox S0. Cloud provider integration and live acceptance are not yet complete. See [docs/STATE.md](docs/STATE.md), [docs/architecture.md](docs/architecture.md), [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md), and [docs/decisions.md](docs/decisions.md).

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
npm run harness -- code --provider openrouter --model <cloud-model-id> --sandbox-provider <cloud-provider> "Inspect the project, run tests, and explain the result."
```

D-117 plans command execution through an explicitly selected remote cloud sandbox only. The CLI integration and provider are not yet implemented, so this example is a target interface, not a currently working command. No host execution or local fallback is permitted. File edits and commands remain policy-gated. Sandbox and model-provider egress require separate consent.

`--timeout-ms` sets the Ollama model-request timeout in milliseconds. It must be an integer from 1 to 4,294,967,295; when omitted, Ollama keeps its 120-second default. This is separate from the 120-second approval timeout. The option is Ollama-only.

Cloud model providers use environment-only credentials and per-project egress consent. Model egress is separate from sandbox egress:

```powershell
$env:OPENROUTER_API_KEY = "<set locally; do not paste>"
$env:OPENROUTER_MODEL = "<exact free-tier model id>"
npm run harness -- code --provider openrouter --model "$env:OPENROUTER_MODEL" "Inspect the project and explain the main request flow."
```

Never put API keys in CLI arguments or files. A green test suite does not prove a live provider ran; see `docs/AUDIT-CLOSEOUT.md` and `docs/evidence/`.
