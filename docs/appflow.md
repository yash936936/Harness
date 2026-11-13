# Application flows

This document describes the current control boundaries. The active implementation sequence is in [ROADMAP.md](ROADMAP.md).

## Model request

1. The model adapter resolves the configured provider.
2. Remote destinations pass the model binding and project egress consent checks and the host allowlist.
3. The request event is logged before the request is sent.
4. Provider response or failure is logged with secrets redacted.
5. Budgets, rate limits, and bounded retries apply as configured.

A provider smoke proves connectivity only. It does not prove task quality or cloud sandbox acceptance.

## Governed coding task

1. The CLI validates the project root and task.
2. The coding profile registers the model, tool registry, retrieval, policy gates, input guard, memory, orchestrator, and project file tools.
3. Tool calls pass through grant checks, schema validation, policy hooks, execution, output guarding, and session logging.
4. Risky writes require approval bound to an immutable input snapshot. Hard-denied actions cannot be approved.
5. The CLI returns the task result and session reference.

## Cloud command execution: planned, not enabled

D-117 authorizes commands only inside an explicitly selected remote cloud sandbox. D-118 selects Vercel Sandbox as the first provider. The current adapter creates an empty non-persistent sandbox with deny-all network policy and argv command invocation, then attempts deletion.

The project workspace is not yet transferred and remote changes are not synchronized. The CLI does not register the provider and keeps `COMMAND_TOOL` filtered. Do not describe this path as working project command execution.

Before enabling it, implement secret-safe project snapshotting, path/symlink validation, bounded transfer, conflict-safe result synchronization, provider lifecycle audit, and policy/approval integration. Model egress and sandbox egress require separate consent. Cleanup must be confirmed; failure is a task failure.

## Evaluation

Three demo sessions are qualitative only. Scoring requires D-109's genuine-session count and label ordering. Do not let the model label its own sessions or inspect scorer output before the owner labels and hash are committed.
