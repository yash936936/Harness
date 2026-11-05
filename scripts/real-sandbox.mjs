// Runs the REAL crabbox/Docker sandbox test (test/sandbox-real.test.ts). Needs Docker running and `crabbox` on PATH.
import { spawnSync } from 'node:child_process'
const r = spawnSync('npx', ['vitest', 'run', 'test/sandbox-real.test.ts'], { stdio: 'inherit', shell: true, env: { ...process.env, HARNESS_REAL_CRABBOX: '1' } })
process.exit(r.status ?? 1)
