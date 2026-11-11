/**
 * Host Docker availability detection for the coding CLI.
 * This is a capability check only; it does not create containers or run acceptance workloads.
 */
import { spawnSync } from 'node:child_process'

export function dockerEngineAvailable(): boolean {
  const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    timeout: 4000, windowsHide: true, stdio: 'ignore', shell: false, env: process.env,
  })
  return result.status === 0 && !result.error
}
