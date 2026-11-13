# Component: model-adapter

> Area type: bundle. Location: `src/bundles/model-adapter/`. This guide describes the current implementation.

## Purpose

Provides a common language-model completion service over provider adapters. It normalizes requests and responses, exposes structured provider errors, and applies the egress policy before any remote request.

## Route (how control reaches it)

Profiles install the model-adapter service as `ctx.llm`. Providers such as Ollama and OpenAI-compatible endpoints are registered with the service. Agent-loop and other callers use `ctx.llm.complete()`; they do not call provider transports directly.

## Config surface and invariants

- Provider registration identifies a default provider and optional fallbacks.
- Provider request timeouts and retry metadata are carried through structured errors.
- Remote providers require the egress dependency and per-project consent.
- API credentials remain in provider-private configuration and are not included in model-visible messages or session events.
- Budget and rate-limit helpers are separate modules used to bound provider usage.

## Known limits

- Provider compatibility does not guarantee identical model behavior or tool-call formats.
- Retryability is a transport/provider signal, not proof that retrying a task is safe.
- Live-provider acceptance is separate from unit tests and CI.
- See D-022 and the current S7 status in `docs/status.md`.

---
**Next:** Return to [`context.md`](../../context.md).
