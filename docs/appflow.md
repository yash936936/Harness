# App flow — Coding Harness

> "User" here is whoever submits a task to the harness: the project owner,
> through the terminal wizard, later the desktop app (D-025), or a direct API
> call. Flows below are the harness's own operational paths, derived from the
> guardrail and orchestration design in `docs/architecture.md`. The first-run
> and rate-limit flows describe planned behavior (Phase 1B); the model call
> checks they rely on (consent gate, rate limiter, error kinds) exist today.

## First run (planned, Phase 1B.2)
1. The user opens the wizard (terminal, later desktop) and sees a provider
   list: tested providers first, then "Other OpenAI-compatible" with a base
   URL and key. A visible "Use a local model instead" link leads to the
   advanced local setup.
2. The user enters a key. It goes to the OS credential store, never the
   project directory, the log or a prompt.
3. A connection test lists models, makes one tiny call, and shows latency.
   The user picks a pinned model ID (a fallback list is stored with it).
4. Consent screen: says plainly that code and context go to the chosen
   provider, what redaction removes, and the provider's stated retention
   policy as a claim with its check date. The user can turn this off per
   project. Nothing is sent before they accept.
5. The user sets a budget in requests and tokens.
6. `doctor` shows the active binding, data destinations, budget, and what
   works offline.

## Model call to a remote provider
1. `ctx.llm.complete()` resolves the provider. If it reaches a non-loopback
   host and consent is missing, the call is refused with kind `consent`,
   `model.blocked` is logged, and nothing is sent.
2. Otherwise `model.request` is logged with the destination host and payload
   size (fail-closed: no log, no call).
3. The rate limiter waits for its window and a free slot, and counts the
   attempt against the daily total.
4. The request goes out. Errors return with a kind: `auth`, `payment`,
   `quota`, `rate_limit`, `server`, `network`, `timeout`, `invalid_request`.
5. `model.response` or `model.error` is logged.

## Rate limit or quota reached
1. A `rate_limit` error (per-minute limit or provider congestion) is
   retried by the agent loop after `retryAfterMs`, or moves to the next
   fallback provider or model, if one is configured.
2. A `quota` error (daily limit) is not retried. The harness stops model
   calls, keeps doing what Needle and rules can do for read-only work, and
   tells the user what is degraded and roughly when the quota may reset.
3. A `payment` error tells the user the account is out of credit or has a
   negative balance, including for free models.

## Task submission and autonomous execution
1. User submits a task to the orchestrator.
2. Orchestrator plans and spawns one or more scoped sub-agents.
3. Each sub-agent runs its ReAct loop: reason → retrieve context (if
   needed) → call a tool.
4. Read-only actions (search, grep, retrieval, browsing) and sandbox-scoped
   writes execute autonomously, logged to the session log.
5. Orchestrator returns the result to the user once all sub-agents
   complete or the task is otherwise resolved.

## Real-filesystem write requiring approval
1. A sub-agent proposes a write outside the sandbox/scratch workspace.
2. `tools/pre-execute` checks the action's confidence score
   (self-reported, cross-checked against an independent heuristic).
3. If confidence is at/above threshold: allowed, logged, execution continues.
4. If below threshold: held, an approval-pending event is written to the
   session log, and the user is prompted.
5. User approves or denies; the resolution is itself logged.
6. On approval, the write executes; on denial, the sub-agent replans.

## External research via the browser tool
1. Sub-agent requests browser access (`ctx.browser`, via agent-browser).
2. Domain allowlist is checked — only approved domains are reachable by
   default.
3. Fetched page content is wrapped in content-boundary markers before it
   reaches the model, and passed through a prompt-injection pattern check.
4. If the sub-agent wants to reach a domain outside the allowlist, that's
   itself a policy-gated action requiring approval.
5. Post-hoc scan checks the sub-agent's output for accidental secret
   leakage before it's surfaced to the orchestrator or user.

## Deny-listed action (hard stop)
1. A sub-agent attempts an action matching the deny-list (prod credentials,
   `rm -rf`, force-push, or a wrapped/aliased equivalent).
2. `tools/pre-execute` rejects it immediately — hard stop, no
   confidence-threshold override possible.
3. The rejection is logged to the session log as a first-class event,
   visible in the same audit trail as successful actions.

---
**Next:** Return to [`context.md`](../context.md).
