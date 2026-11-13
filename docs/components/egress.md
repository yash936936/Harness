# Component: egress

> Area type: bundle. Location: `src/bundles/egress/`. This guide describes the current implementation.

## Purpose

Controls outbound data per project. It requires explicit consent for remote destinations, restricts remote calls to configured hostnames, and redacts registered secret values from outbound payloads and session-log events.

## Route (how control reaches it)

Profiles install `EgressPolicy` as `ctx.egress`. The model-adapter injects it as a required dependency before remote provider calls. The service also registers a session-log redactor when a log service is present. Callers use its consent, allowlist, and redaction methods rather than implementing their own checks.

## Config surface and invariants

- `projectId` is required and consent is scoped to that project.
- `consentStore` selects persistence; the default is in-memory.
- `allowedHosts` is an explicit hostname allowlist. An empty list allows no remote host.
- `secrets` registers named values for redaction. Longer values are replaced first.
- Remote calls require both project consent and an allowed destination.
- Provider API keys remain in provider configuration and are added at the HTTP layer, not placed in model-visible request objects.

## Known limits

- This is an egress policy layer, not a general-purpose secret vault or network firewall.
- Redaction only covers values registered with the service.
- Consent does not establish that a remote provider's retention or training policy is acceptable.
- See D-029 and D-054.

---
**Next:** Return to [`context.md`](../../context.md).
