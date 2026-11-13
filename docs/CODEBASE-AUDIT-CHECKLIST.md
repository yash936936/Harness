# Full codebase audit checklist

Baseline: `main` at `81d7bf837254b8526b60aa240d6a31923647a890` (2026-11-14).
Audit branch: `audit/full-codebase-review-2026-11`.

This is a staged, evidence-based audit. Review each file, then each folder, then cross-folder flows. Do not remove code solely because it appears old or duplicated; first verify imports, runtime registration, scripts, tests, docs, and history. Do not weaken D-110/D-117/D-118 security boundaries.

## Audit protocol

- [ ] Record the exact file and relevant lines for each finding.
- [ ] Trace imports, exports, runtime registration, CLI/profile reachability, and tests before classifying code as dead.
- [ ] Distinguish production code, test fixtures, benchmarks, historical scripts, generated files, and evidence artifacts.
- [ ] For each finding record severity (P0-P3), confidence, impact, minimal fix, regression test, and verification.
- [ ] Fix one bounded issue at a time; run focused tests before folder-level tests.
- [ ] After each folder, run typecheck/lint and the relevant test subset.
- [ ] After cross-folder work, run full test suite, docs drift, secret scan, dependency audit, license inventory, and platform CI.
- [ ] Never execute development commands on the host or use local fallback; D-117 requires an explicitly selected remote cloud sandbox. Do not probe Docker/WSL/Crabbox under D-110.
- [ ] Keep `COMMAND_TOOL` disabled until workspace transfer, result sync, lifecycle audit, and policy integration are complete.

## Checklist

### A. File-level correctness
- [ ] Stale, obsolete, unreachable, unused, or shadowed code
- [ ] Duplicate implementations, repeated constants, parallel helpers, and copy/paste drift
- [ ] Fake loops, no-op branches, placeholder success, hardcoded/mock responses in production paths
- [ ] Hardcoded paths, ports, hosts, model/provider names, limits, retry counts, timeouts, and assumptions
- [ ] Invalid defaults, missing validation, unchecked casts, unsafe parsing, and weak types
- [ ] Error handling, cancellation, timeout, cleanup, retry/idempotency, and partial-failure behavior
- [ ] Resource lifecycle: child processes, streams, timers, file handles, DB connections, sandbox leases
- [ ] Input/output bounds, pagination, memory/CPU use, large-file behavior, and denial-of-service risks
- [ ] Logging quality, secret/PII redaction, event consistency, and useful diagnostics
- [ ] API compatibility, version drift, dependency risk, licensing, and reproducible installs

### B. Security and trust boundaries
- [ ] Path traversal, symlink escape, TOCTOU, unsafe archive extraction, and workspace boundary violations
- [ ] Command injection, shell use, argv validation, environment inheritance, and host execution
- [ ] Authentication, authorization, consent scope, allowlists, policy snapshots, and fail-closed behavior
- [ ] Secret exposure through env, args, files, logs, model context, sandbox transfer, or test fixtures
- [ ] Prompt injection and untrusted model/tool/retrieval output handling
- [ ] Network egress controls, SSRF, redirect handling, TLS, and provider endpoint validation
- [ ] Audit log integrity, ordering, append-only behavior, redaction, and tamper detection

### C. Architecture and scaling
- [ ] Circular imports, hidden global state, singleton coupling, and service initialization order
- [ ] Module boundaries, dependency direction, contract duplication, and unclear ownership
- [ ] Concurrency races, locking, backpressure, queue growth, rate limits, and fairness
- [ ] Unbounded caches, histories, event logs, memory stores, and vector indexes
- [ ] Multi-session/project isolation, tenant boundaries, and state leakage
- [ ] Provider portability and capability negotiation without unsafe fallback
- [ ] Deterministic behavior, reproducibility, migration/versioning, and crash recovery
- [ ] Observability: trace/correlation IDs, metrics, structured events, and actionable failure states

### D. Tests and CI quality
- [ ] Every production module has relevant behavioral tests
- [ ] Tests assert outcomes and side effects, not only that code did not throw
- [ ] Negative, boundary, malformed-input, timeout, cancellation, race, and failure-injection coverage
- [ ] Fake/mock behavior cannot be mistaken for live acceptance
- [ ] Fixtures are isolated, deterministic, bounded, and cleaned up
- [ ] CI checks match documented commands and cover supported OS/runtime versions
- [ ] Security, dependency, license, docs generation, and generated-file drift checks
- [ ] Test flakiness, order dependence, hidden network/host dependencies, and skipped tests

### E. Documentation and contract consistency
- [ ] Source behavior matches AGENTS.md, decisions, STATE, roadmap, build plan, and component guides
- [ ] CLI/profile/config schemas match actual runtime registration and defaults
- [ ] Docs do not claim features that are missing, disabled, fake-tested only, or not live-accepted
- [ ] Generated docs are generated, current, and not hand-maintained in generated regions
- [ ] Historical/held scripts cannot be mistaken for active instructions

## Folder-by-folder ledger

- [ ] Repository root configuration and package manifests
- [ ] `.github/workflows`
- [ ] `src/bundles/agent-loop`
- [ ] `src/bundles/app-core`
- [ ] `src/bundles/egress`
- [ ] `src/bundles/embeddings`
- [ ] `src/bundles/eval-runner`
- [ ] `src/bundles/input-guard`
- [ ] `src/bundles/memory`
- [ ] `src/bundles/model-adapter`
- [ ] `src/bundles/model-store`
- [ ] `src/bundles/orchestrator`
- [ ] `src/bundles/policy-gates`
- [ ] `src/bundles/retrieval-grep`
- [ ] `src/bundles/retrieval-rank`
- [ ] `src/bundles/retrieval-tools`
- [ ] `src/bundles/retrieval-treesitter`
- [ ] `src/bundles/router`
- [ ] `src/bundles/sandbox*`
- [ ] `src/bundles/session-log`
- [ ] `src/bundles/skills`
- [ ] `src/bundles/subagent-scope`
- [ ] `src/bundles/subprocess`
- [ ] `src/bundles/tool-registry`
- [ ] `src/bundles/tools-local`
- [ ] `src/bundles/vectorstore-lancedb`
- [ ] `src/cli`
- [ ] `src/profiles`
- [ ] `src/util`
- [ ] `scripts` (including historical/held utilities)
- [ ] `app/desktop/bench`
- [ ] `test` and `test/fixtures`
- [ ] Cross-folder integration and data-flow review
- [ ] Docs and code contract reconciliation
- [ ] Full CI and final findings review

## Findings

No findings recorded yet. Add findings here with stable IDs and evidence. Do not mark a folder complete until every file in its scope has been read and its imports/callers/tests have been traced.
