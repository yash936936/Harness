# Acceptance evidence templates

- `real-run-labels.template.json`: copy to a private working file, replace keys with genuine session IDs, and label each run independently before viewing scorer output. D-109 requires at least 10 genuine labels (20+ if available), both `good` and `bad`, and a committed labels file plus SHA-256 before scorer output.
- `model-provenance.template.json`: use an immutable upstream revision and the SHA-256 of the exact downloaded artifact. The template intentionally cannot pass verification.
- Never commit API keys, model weights, private session logs, or raw user data.

Needle evidence must come from `scripts/eval-router.ts` using the real frozen suite and actual worker and Needle backend. `HARNESS_STANDIN=1` is a script self-test, not acceptance evidence. Keep `router.owned` empty unless the documented real-measurement comparison rule is met.

## Sandbox evidence

- D-110 permanently holds Docker/WSL/Crabbox S0. Do not run the historical Crabbox/CubeSandbox acceptance procedure.
- D-117/D-118 select cloud-only command execution through Vercel Sandbox. The provider is not yet integrated for project workflows.
- Vercel acceptance must cover secret-safe workspace transfer, bounded snapshot/result handling, path and symlink defenses, policy-approved and denied commands, secret-leak checks, and confirmed cleanup. Fake clients and an empty-sandbox smoke are not project acceptance.

Desktop application measurements are out of scope under D-115. Historical benchmark files are retained but are not an active acceptance requirement.
