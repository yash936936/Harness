# Component: app-core

> Area type: bundle. Location: `src/bundles/app-core/`. This guide describes the current implementation.

## Purpose

Provides shared application setup services for budgets, credential storage, provider connection checks, consent-screen content, and a read-only doctor report. It gives terminal or future desktop clients a common place to use these operations.

## Route (how control reaches it)

A caller installs `AppCore` as `ctx.appCore` or imports its helper exports directly. The service constructs the configured budget and credential stores. The CLI wizard uses the connection-test, consent-screen, and doctor methods. The service is intentionally standalone and is not a hidden profile-wide policy switch.

## Config surface and invariants

- `budgets` configures request and token budgets.
- `credentials.store` can inject a store. Otherwise the service uses the keychain-first, file-fallback credential chain.
- The default credential file is under `.harness/credentials.json`.
- Consent is handled by the separate `egress` service and is passed into doctor reporting rather than inferred.
- Provider connection tests take an already constructed provider and return a structured result.

## Known limits

- Doctor is a read-only status report, not proof of successful sandbox or live-model acceptance.
- The default file credential fallback is not equivalent to an OS keychain.
- Model bindings are reported only when a model-store source is supplied.
- See D-025 and the current prototype status in `docs/status.md`.

---
**Next:** Return to [`context.md`](../../context.md).
