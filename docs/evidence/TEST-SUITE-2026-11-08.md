# Historical automated test evidence

> This is an owner-reported test result from 2026-11-08, not the current CI state. It does not prove live sandbox acceptance. Current CI status and blockers are in [STATE.md](../STATE.md).

---

# Automated test-suite evidence

Date: 2026-11-08
Source: owner-reported Windows PowerShell output from the local working copy.
Command: `npm test`

## Result

```text
Test Files  56 passed | 1 skipped (57)
Tests       1182 passed | 22 skipped (1204)
Start at    14:49:23
Duration    64.00s (transform 31.35s, setup 0ms, import 88.36s, tests 305.41s, environment 70ms)
```

Failed test files: 0
Failed tests: 0

The owner reported this output after the earlier isolated concurrent-writers test passed three consecutive times (approximately 1.55-1.62 seconds each). The full-suite run therefore confirms that the earlier 5-second concurrent-writers timeout did not recur in this run.

## Limits

- This is a local test-suite result, not a GitHub Actions result.
- The one skipped test file is `test/sandbox-real.test.ts`; both real Crabbox/Docker tests were skipped.
- This does not prove a real sandbox lease, command execution, release, host isolation, or orphan recovery.
- The exact raw terminal transcript was not attached; this evidence preserves the complete summary supplied in chat, not a fabricated raw log.

## Acceptance status

- Automated suite: PASS (owner-reported, 2026-11-08).
- S0 real Crabbox/Docker acceptance: BLOCKED-HARDWARE.
- S1 host-sentinel and orphan-lease recovery: OPEN.
