# Coding Harness

A TypeScript multi-agent coding harness built on [Cordis](https://github.com/cordiverse/cordis). Profiles compose model access, tools, retrieval, memory, orchestration, policy gates, sandbox providers, and evaluation.

**Project status (2026-11-14):** research/sample prototype. The current direction is cloud-hosted model inference and command execution only in an explicitly selected remote cloud sandbox. D-118 selects Vercel Sandbox as the first provider. Its adapter exists, but workspace transfer, result synchronization, lifecycle audit, CLI integration, and live acceptance remain incomplete. The command tool stays disabled.

## Current decisions

- D-110: Docker/WSL/Crabbox S0 is permanently held; S1 is deferred.
- D-117: no host command execution or local fallback. Model and sandbox egress require separate consent and host allowlists.
- D-118: Vercel Sandbox is the first provider, not yet end-to-end accepted.
- D-109: scoring requires 10+ genuine sessions and owner labels committed/hashed before scoring.
- D-115: no package, release, hosted distribution, or model-weight distribution is planned.

See [current state](docs/STATE.md), [build plan](docs/BUILD-PLAN.md), and [roadmap](docs/ROADMAP.md).

## Development checks

```sh
npm ci
npm run check
npm run docs:check
```

Audit branch CI run 43516548037 passed on commit `30401b9267fbf5e2578b752f61ba802a2e1dba1c`, including Ubuntu and Windows checks, dependency audit, docs drift, and license inventory. Follow [STATE.md](docs/STATE.md) for the current branch and merge status.

## Capability boundary

The governed coding flow supports policy-gated project file operations. Cloud command execution is not yet exposed through the CLI. Do not use host subprocess execution as a substitute. The example cloud workflow is intentionally omitted until workspace transfer and result synchronization are safe and integrated.

Original project code is licensed under Apache-2.0. Third-party dependencies and model artifacts retain their own terms; see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
