# Authoritative prototype state

Updated 2026-11-13 after D-117. D-117 is the current owner-approved direction for cloud-only command execution and cloud-hosted model testing. Historical D-116 wording remains in the decision history but is superseded where D-117 explicitly says so. Green CI is not live cloud acceptance.

## Scope and decisions

| Item | Current state | Evidence / boundary |
|---|---|---|
| D-117 | ACCEPTED: CLOUD EXECUTION | Full development command workflow only inside a remote cloud sandbox. No host fallback. Independent model and sandbox egress consent. Implementation and live acceptance remain open. |
| D-110 | S0 PERMANENT-HOLD | No Docker/WSL/Crabbox probes, retries, workarounds or host execution. D-117 adds a separate cloud route and does not reopen S0. |
| D-116 D1/D2 | SUPERSEDED IN PART | No-command and 3B-only testing constraints are superseded only by D-117's cloud sandbox and cloud-model testing scope. D-116 D3 remains unchanged. |
| D-114 | SUPERSEDED FOR TEST MODEL SCOPE | Cloud-hosted models are the testing target under D-117. Qwen 7B artifact/distribution exclusion remains. |
| D-116 D3 / D-109 | UNCHANGED | Three demo sessions are qualitative only. Scorer output still requires at least 10 genuine sessions, both owner labels, and labels committed/hashed before scoring. |
| D-115 | UNCHANGED | Sample/research prototype; no distribution/release artifact. |
| Branch protection | OPEN OWNER ACTION | Require PRs and ci-pass, up-to-date branches, no force-push/deletion, no admin bypass. |

## Cloud execution architecture

| Control | Required behavior |
|---|---|
| Destination | Remote cloud sandbox only; explicit provider selection; no local or host fallback |
| Scope | Read/search, dependency install, build, test, Git status/diff/branch/commit, subject to policy |
| Invocation | argv only; no implicit shell, pipes, redirects or command substitution |
| Isolation | Per-task project snapshot, non-root workspace, resource/time/output limits, verified teardown |
| Policy | Existing policy gates, risk classification, immutable approval snapshots and hard denials remain mandatory |
| Egress | Independent model-provider and sandbox-provider consent/host allowlists; sandbox network disabled by default |
| Secrets | No host credentials, model API keys, SSH agents or credential stores passed to sandbox |
| Audit | Provider/host/lease, argv/cwd, policy and approval, timestamps, exit status, bounded redacted output, timeout/cancel and release status |

## Current implementation status

The sandbox service already gates remote providers on project consent and host allowlisting. The sandbox provider interface and sandbox-backed command tool exist. The governed CLI still filters COMMAND_TOOL, and no cloud sandbox provider is selected or live-verified. Current Ollama adapter code does not establish API-key support for Ollama cloud. Therefore cloud command execution and cloud-model acceptance are authorized work, not completed capabilities.

## Phase state

| ID | State | Remaining evidence / action |
|---|---|---|
| R2.1 architecture | DOCUMENTED | Provider contract and threat model are described; implementation review remains |
| R2.2 cloud provider | NOT STARTED | Select provider; implement lifecycle and isolation |
| R2.3 policy integration | NOT STARTED | Enable command tool only behind cloud provider and existing gates |
| R2.4 audit/egress | NOT STARTED | Add lifecycle events, separate egress policy and redaction tests |
| R2.5 cloud models | PARTIAL / VERIFY | OpenRouter supported path; Ollama cloud auth/API needs verification |
| R2.6 CLI integration | NOT STARTED | Consent UX, explicit provider, no fallback |
| R2.7 acceptance | NOT STARTED | Live cloud build/test and security evidence |
| S0 | PERMANENT-HOLD | D-110 remains unchanged |
| S1 | DEFERRED-S0-HOLD | Depends on S0 |
| S3 | CLOSED (D-111) | File-tool/policy acceptance only |
| S4 | REOPENED AS CLOUD-ONLY PLAN, NOT PASSED | Full provider tasks require live cloud sandbox evidence |
| S6 | OPEN | D-109 genuine sessions and owner-label requirements remain |
| S7 | OPEN / RECONCILIATION REQUIRED | Existing live evidence still needs reconciliation; do not infer pass |
| R3 demo | NOT STARTED | Three qualitative sessions and Windows quickstart/demo artifacts remain |



## D-118 provider selection update — 2026-11-13

Vercel Sandbox is the selected first provider. The initial adapter exists at `src/bundles/sandbox-vercel/index.ts` and is tested with an injected fake SDK client. It explicitly requests `persistent: false` and `networkPolicy: 'deny-all'`, forwards argv as `cmd` plus `args`, and calls `delete()` in a finally path. The sandbox service's existing remote-consent and exact-host allowlist gate runs before provider contact.

**Not yet integrated:** The profile and CLI do not register/select this provider. The command tool remains filtered from the governed CLI. The provider currently runs in a fresh empty sandbox and does not transfer the project workspace or return remote changes. Do not enable `COMMAND_TOOL` until a secret-safe project snapshot and result-sync design is implemented and tested.

| ID | State | Remaining action |
|---|---|---|
| R2.2 cloud provider | IN PROGRESS | Adapter added; verify SDK compatibility/version and host; add profile registration and real credential-backed doctor/smoke |
| R2.3 policy integration | NOT STARTED | Keep tool disabled until workspace transfer and result-sync can preserve all policy guarantees |
| R2.4 audit/egress | PARTIAL | Existing egress gate is reused; provider-specific lifecycle audit events and output redaction coverage remain |
| R2.6 CLI integration | NOT STARTED | Explicit provider selection and project-transfer consent UX |
| R2.7 acceptance | NOT STARTED | Live Vercel sandbox plus end-to-end project workflow evidence |

D-110 remains unchanged. No Docker, WSL, Crabbox or host command probes were run. S0 remains PERMANENT-HOLD and S4 is NOT PASSED.
