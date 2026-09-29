// Shared helpers for measure-electron.mjs / measure-tauri.mjs. Nothing in this file has been
// run end-to-end in the environment that wrote it - see README.md's "What was actually verified
// here" section. Written carefully, not tested against a real Electron or Tauri build.

import { spawn } from 'node:child_process'
import { appendFile, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

export function fail(message) {
  console.error(`\nmeasurement aborted: ${message}\n`)
  process.exit(1)
}

export function requireCommand(cmd, args, installHint) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'ignore', shell: process.platform === 'win32' })
    p.on('error', () => fail(`"${cmd}" isn't on PATH. ${installHint}`))
    p.on('exit', (code) => (code === 0 ? resolve() : fail(`"${cmd} ${args.join(' ')}" exited ${code}. ${installHint}`)))
  })
}

/** Runs a command, streaming its output live (these builds can take minutes and give no other feedback). */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    console.log(`  $ ${cmd} ${args.join(' ')}`)
    const p = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts })
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
  })
}

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Recursively finds the first file under `dir` for which `predicate(relativePath)` is true, skipping any path segment in `skipDirs`. */
export async function findFirst(dir, predicate, skipDirs = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const entry of entries) {
    if (skipDirs.includes(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = await findFirst(full, predicate, skipDirs)
      if (found) return found
    } else if (predicate(full)) {
      return full
    }
  }
  return undefined
}

export async function fileSizeMB(path) {
  const s = await stat(path)
  return s.size / (1024 * 1024)
}

/**
 * Cold start: spawns the built app, polls for `markerPath` (the app's own instrumentation
 * writes a timestamp there the instant its window becomes visible - see the per-shell patch)
 * up to 15s, and returns spawn-to-marker milliseconds. Kills the process afterward - the caller
 * is responsible for a fresh spawn per sample, since a warm second launch is a different number
 * (Electron/Tauri both cache things between runs of the same installed app).
 */
export async function coldStartOnce(exePath, exeArgs, markerPath) {
  try {
    await import('node:fs').then((fs) => fs.promises.rm(markerPath, { force: true }))
  } catch {}
  const start = performance.now()
  const child = spawn(exePath, exeArgs, { stdio: 'ignore', detached: false })
  const pid = child.pid
  const deadline = start + 15_000
  while (performance.now() < deadline) {
    if (existsSync(markerPath)) {
      const elapsed = performance.now() - start
      try {
        child.kill()
      } catch {}
      return { ms: Math.round(elapsed), pid }
    }
    await new Promise((r) => setTimeout(r, 25))
  }
  try {
    child.kill()
  } catch {}
  fail(
    `no ready marker appeared at ${markerPath} within 15s. Either the app failed to start (run it ` +
      `manually to see why) or its instrumentation patch didn't take - check that the patch step actually ` +
      `modified the template file (template layouts change between CLI versions).`,
  )
}

/**
 * Pure: given a process snapshot [{ProcessId, ParentProcessId, WorkingSetSize(bytes)}], sums the
 * working set of `rootPid` and every descendant. This is the number that matters: Electron's
 * renderer/GPU helpers and Tauri's msedgewebview2.exe children are separate processes that share
 * no image name with the app exe, so matching by image name (the D-045 approach) missed them -
 * and matched nothing at all on the owner's first run (both rows read 0.0). Note: working set
 * double-counts pages shared between processes, so this slightly overstates both shells.
 */
export function sumTreeWorkingSetMB(procs, rootPid) {
  const byParent = new Map()
  for (const p of procs) {
    const list = byParent.get(p.ParentProcessId) ?? []
    list.push(p)
    byParent.set(p.ParentProcessId, list)
  }
  const seen = new Set()
  const stack = [rootPid]
  let bytes = 0
  let count = 0
  const byPid = new Map(procs.map((p) => [p.ProcessId, p]))
  while (stack.length) {
    const pid = stack.pop()
    if (seen.has(pid)) continue
    seen.add(pid)
    const self = byPid.get(pid)
    if (self) {
      bytes += Number(self.WorkingSetSize) || 0
      count++
    }
    for (const c of byParent.get(pid) ?? []) stack.push(c.ProcessId)
  }
  return { mb: bytes / 1024 / 1024, processCount: count }
}

/**
 * Working-set MB of the process tree rooted at `rootPid` (Windows, via PowerShell CIM).
 * Fails loudly on an empty result instead of returning 0 - a silent 0 is what produced the
 * invalid first-run rows.
 */
export async function treeWorkingSetMB(rootPid) {
  if (process.platform !== 'win32') {
    fail('treeWorkingSetMB only implements the Windows path - the target machine for 1B.4 is Windows.')
  }
  const cmd =
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Json -Compress'
  const out = await new Promise((resolve, reject) => {
    const p = spawn('powershell', ['-NoProfile', '-Command', cmd])
    let buf = ''
    p.stdout.on('data', (d) => (buf += d))
    p.on('error', reject)
    p.on('exit', () => resolve(buf))
  })
  const procs = JSON.parse(out)
  const r = sumTreeWorkingSetMB(Array.isArray(procs) ? procs : [procs], rootPid)
  if (r.processCount === 0 || r.mb <= 0) {
    fail(`process ${rootPid} not found in the process list (it may have exited before sampling) - idle memory not recorded.`)
  }
  return r
}

export async function appendResultRow(csvPath, row) {
  const header = 'timestamp,shell,installer_size_mb,cold_start_ms_avg,cold_start_ms_samples,idle_memory_mb,notes\n'
  const exists = existsSync(csvPath)
  if (!exists) await writeFile(csvPath, header)
  const line = [
    new Date().toISOString(),
    row.shell,
    row.installerSizeMB.toFixed(1),
    row.coldStartMsAvg.toFixed(0),
    row.coldStartSamples.join(';'),
    row.idleMemoryMB.toFixed(1),
    `"${(row.notes ?? '').replace(/"/g, "'")}"`,
  ].join(',')
  await appendFile(csvPath, line + '\n')
  console.log(`\nAppended to ${csvPath}:\n  ${line}\n`)
}
