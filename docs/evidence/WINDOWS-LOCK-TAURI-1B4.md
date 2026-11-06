# Windows locking and desktop closeout follow-up

Date: 2026-11-06

| ID | Current result | Evidence | Remaining proof/action |
|---|---|---|---|
| Windows paused-lock | Implementation corrected; automated stalled-holder and crash-holder regressions added. Actual OS-suspended Windows acceptance is **BLOCKED-HARDWARE/TOOL** until PsSuspend is available on the owner Windows host. | `src/util/filelock.ts`, `test/session-log-multiprocess.test.ts`, `test/fixtures/append-worker.ts`, `scripts/test-windows-paused-lock.ps1`, D-108 | Run `npm ci` then `powershell -ExecutionPolicy Bypass -File scripts/test-windows-paused-lock.ps1 -PsSuspendPath C:\\Tools\\PsSuspend64.exe`; preserve complete terminal output. |
| Tauri desktop | **DEFERRED / NOT IMPLEMENTED** as a product. `app/desktop/bench/hello-tauri` is only a shell benchmark. | `app/desktop/bench/README.md`, `app/desktop/bench/hello-tauri/src-tauri/src/lib.rs`, D-048 | Implement the Node sidecar, random per-launch token, loopback-only JSON-RPC, authenticated request validation, real core start/approval/replay APIs, three live screens, sidecar lifecycle, and packaging. Then run on the target Windows machine. |
| 1B.4 | **PARTIAL**. The desktop application acceptance criteria are not met. | `docs/decisions.md` D-025/D-048; benchmark files under `app/desktop/bench/` | Complete the real desktop integration above; measure cold start and idle memory with Node core on target machine; record results and a new decision before choosing/falling back to Electron. |

No desktop demo data or fabricated performance numbers are supplied. A working benchmark hello-world is not evidence of a working Harness desktop client.
