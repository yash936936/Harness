# Historical Windows lock and desktop evidence

> Windows paused-lock acceptance remains a historical result for the documented scenario. Desktop implementation is out of scope for the current sample prototype under D-115. This note is not a current desktop work order. See [STATE.md](../STATE.md).

---

# Windows locking and desktop closeout follow-up

Date: 2026-11-06

| ID | Current result | Evidence | Remaining proof/action |
|---|---|---|---|
| Windows paused-lock | **PASSED on owner Windows host.** Sysinternals PsSuspend v1.09 executed successfully. The dedicated OS-suspension regression ran, not skipped. | `src/util/filelock.ts`, `test/session-log-multiprocess.test.ts`, `test/fixtures/append-worker.ts`, `scripts/test-windows-paused-lock.ps1`, D-108 | Windows acceptance is closed for this scenario. Broader stress on each supported target filesystem/platform remains separate; this is not a power-loss durability claim. |
| Tauri desktop | **DEFERRED / NOT IMPLEMENTED** as a product. `app/desktop/bench/hello-tauri` is only a shell benchmark. | `app/desktop/bench/README.md`, `app/desktop/bench/hello-tauri/src-tauri/src/lib.rs`, D-048 | Implement the Node sidecar, random per-launch token, loopback-only JSON-RPC, authenticated request validation, real core start/approval/replay APIs, three live screens, sidecar lifecycle, and packaging. Then run on the target Windows machine. |
| 1B.4 | **PARTIAL**. The desktop application acceptance criteria are not met. | `docs/decisions.md` D-025/D-048; benchmark files under `app/desktop/bench/` | Complete the real desktop integration above; measure cold start and idle memory with Node core on target machine; record results and a new decision before choosing/falling back to Electron. |

## Windows acceptance run

Command:

```powershell
.\scripts\test-windows-paused-lock.ps1 -PsSuspendPath "C:\Tools\PsSuspend64.exe"
```

Tool:
- Sysinternals PsSuspend v1.09
- Executable: `C:\Tools\PsSuspend64.exe`
- Executable file length: 448,800 bytes

Result:
- Test file: `test/session-log-multiprocess.test.ts`
- Test files: 1 passed
- Tests: 15 passed, 0 failed
- Duration: 20.66 seconds
- Exit code: 0
- Explicit regression: `Windows: an OS-suspended live holder is not taken over after staleMs` — passed (1,444 ms)

The run also passed concurrent append ordering, torn-tail recovery, mutual exclusion, dead-owner recovery, live-owner timeout, crash-holder recovery, and multi-process memory-store cases.

No desktop demo data or fabricated performance numbers are supplied. A working benchmark hello-world is not evidence of a working Harness desktop client.
