# Acceptance evidence templates

- `real-run-labels.template.json`: copy to a private working file, replace keys with real session IDs, and label each run independently before viewing scorer output. A passing calibration requires at least 20 labels, both `good` and `bad`, and >=90% agreement.
- `model-provenance.template.json`: replace the revision with an immutable upstream revision and the digest with the SHA-256 of the exact downloaded artifact. The template intentionally cannot pass verification.
- Never commit API keys, model weights, private session logs, or raw user data.

Needle evidence must come from `scripts/eval-router.ts` using the real frozen suite and actual worker and Needle backend. `HARNESS_STANDIN=1` is only a script self-test and is not acceptance evidence. Keep `router.owned` empty unless every proposed class meets the documented comparison rule on real measurements.

Crabbox/CubeSandbox acceptance requires a real provider doctor, a successful isolated command, a failing command, and confirmed lease release. Provider fakes and CI mocks are not acceptance evidence.

Tauri measurements must be collected on the target Windows machine using `scripts/tauri-benchmark.ps1`; record the resulting JSON and machine details outside source control if they identify the device.
