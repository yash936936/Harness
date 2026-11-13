# Component: model-store

> Area type: bundle. Location: `src/bundles/model-store/`. This guide describes the current implementation.

## Purpose

Stores trusted model pins and named bindings so callers can resolve a requested capability to an explicitly registered model identity. It separates a model's declared pin from whether that model is installed or usable on the current host.

## Route (how control reaches it)

A profile or application installs `ModelStore` as `ctx.modelStore` with model pins and bindings. Callers resolve a binding through the service and can inspect registered pins. App-core doctor reporting accepts the model-store interface to report binding availability.

## Config surface and invariants

- Pins and bindings are supplied explicitly; registration is not an installation operation.
- A binding resolves only against registered pin/fallback data.
- Model identity and artifact metadata must remain consistent with the pin definition.
- Installation and digest checks are separate observations and must not be inferred from registration.

## Known limits

- A registered pin is not proof that model weights are installed, immutable, or available.
- Model provenance and digest evidence must be recorded independently.
- No live model acceptance is implied by a successful binding lookup.
- See D-042 and the artifact provenance evidence under `docs/evidence/`.

---
**Next:** Return to [`context.md`](../../context.md).
