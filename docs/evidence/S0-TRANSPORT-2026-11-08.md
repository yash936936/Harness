# S0 Windows transport status

Date: 2026-11-08  
Repository baseline: `fb4f2fa27570254c62a5cdfc16e392a77ff7c875` (main, PR #20 merged)

## Current disposition

**S0 / ARCH-01: PENDING-ENVIRONMENT.** Pause further Crabbox transport debugging and continue independent closeout work. This is not a pass and no root cause is claimed.

## Evidence already observed

- The pinned local-container image `harness-crabbox-s0:ubuntu-pinned` completed `crabbox warmup` successfully. The CLI reported a ready lease and SSH endpoint; the Docker container was running.
- `crabbox inspect` worked for the resulting lease.
- `crabbox run` failed before the requested in-box command executed. The diagnostic was:

```text
rsync failed: write private WSL SSH transport file:
exit status 1: crabbox: 1: cannot create : Directory nonexistent
chmod: cannot access '': No such file or directory
```

- The failure occurred while Crabbox prepared its private WSL SSH transport file. The empty pathname is evidence of a path/argument setup failure, but the exact layer and root cause have not been isolated.
- `crabbox stop` succeeded and the lease disappeared from the provider list.
- The workload exit-code checks (0 and 7), host-file isolation, and complete Harness real-sandbox acceptance have **not** passed.

## Do not infer

- Successful warmup does not prove `crabbox run` works.
- SSH readiness or authentication does not prove a command ran inside the container.
- The diagnostic does not yet prove whether the failure is WSL argument forwarding, Crabbox's transport helper, or a local WSL distribution/tool configuration issue.
- PR #20 improves bounded warmup diagnostics only. It does not fix the WSL transport failure.

## Resume condition

Resume S0 only when ready to run the isolated Windows/WSL transport probe and capture its complete output. Then verify, in order: WSL native `rsync` and `ssh`; private temporary-file argument handoff; `crabbox run --no-sync`; synced `crabbox run`; and finally `npm run test:real-sandbox`. Do not modify Harness SSH environment forwarding, image bootstrap, or port mapping without a failing reproduction that identifies that layer.

S1 real orphan-recovery acceptance remains dependent on S0. Do not stop unowned leases or invent a lease ownership schema.
