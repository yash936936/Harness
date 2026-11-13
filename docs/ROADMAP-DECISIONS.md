# Owner decision register

Updated 2026-11-14. This register summarizes the owner decisions that govern the current prototype. The append-only source is [decisions.md](decisions.md).

| Decision | Current disposition |
|---|---|
| D-110 | S0 / Docker, WSL, Crabbox permanently held. S1 deferred. |
| D-115 | Sample/research prototype; no distribution or release artifact. |
| D-116 D1/D2 | Superseded narrowly by D-117 for cloud-only commands and cloud model testing. |
| D-116 D3 | Three owner-reviewed sessions are qualitative only. |
| D-117 | Commands only in an explicitly selected remote cloud sandbox. No host/local fallback. |
| D-118 | Vercel Sandbox is the first provider. Keep command tool disabled until workspace transfer, result sync, lifecycle audit, and policy integration pass. |
| D-109 | Scorer requires 10+ genuine sessions (20+ if available), owner good/bad labels committed and hashed before scoring. |

D-117 does not reopen S0 or authorize host execution. D-118 selects a provider but does not claim integration or live acceptance. S4 remains open and cloud-only. See [STATE.md](STATE.md) for the active implementation status and [ROADMAP.md](ROADMAP.md) for the ordered work plan.
