import { open, readFile, stat, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'

/**
 * A cross-process advisory lock on a path (BUG-07, BUG-09). The in-process queues the stores use serialise callers inside ONE
 * process; two harness processes sharing a directory need the filesystem to arbitrate. The lock is a file created exclusively
 * (`wx`, atomic on local filesystems) holding the owner's pid and a random token.
 *
 * - A held lock is waited for up to `timeoutMs`, then `LockTimeoutError` is thrown. Never a silent skip: proceeding unlocked
 *   is exactly the corruption this prevents.
 * - A lock with a valid, live owner pid is NEVER broken due to age. This protects a paused/suspended process.
 * - A lock with a dead owner pid is broken immediately. An empty/partial/legacy lock without a usable pid is broken only
 *   after `staleMs`, which recovers a crash between exclusive create and metadata write.
 * - The break re-checks inode and mtime before deleting. A narrow cross-process TOCTOU window remains because portable
 *   Node APIs do not provide an atomic compare-and-unlink primitive.
 * - Release deletes the file only if it still carries OUR token.
 *
 * Limits, stated plainly: advisory (only code that takes the lock is excluded); assumes one machine and a local filesystem
 * (pid liveness is meaningless across hosts and `wx` is not reliable on some network filesystems).
 */
export class LockTimeoutError extends Error {
  override name = 'LockTimeoutError'
  constructor(public lockPath: string, waitedMs: number) {
    super(`could not take the lock ${lockPath} within ${waitedMs} ms; another harness process is holding it. If none is running, delete the file.`)
  }
}

export interface LockOptions {
  /** A lock untouched this long is treated as abandoned. Default 30000. */
  staleMs?: number
  /** How long to wait for a held lock. Default 10000. */
  timeoutMs?: number
  /** Base wait between attempts. Default 10. */
  retryMs?: number
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e: any) {
    return e?.code === 'EPERM' // exists, just not ours
  }
}

async function tryBreakStale(lockPath: string, staleMs: number): Promise<boolean> {
  let before
  let body: { pid?: number } = {}
  try {
    before = await stat(lockPath)
  } catch (error: any) {
    if (error?.code === 'ENOENT') return true // vanished between our attempts: just retry
    // Windows can deny stat while another process holds an exclusive handle.
    if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'EBUSY') return false
    throw error
  }
  try {
    body = JSON.parse(await readFile(lockPath, 'utf8'))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return true
    // Windows may deny a concurrent read while another process is creating or writing the lock.
    // Treat sharing/permission contention as a held lock and let the bounded retry loop decide.
    if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'EBUSY') return false
    if (!(error instanceof SyntaxError)) throw error
    // Present but empty or half-written: its owner is either mid-write (young: keep waiting) or died between creating and writing it
    // (old: it must be breakable, or one crash wedges the lock for good). Judged by age below, with no pid to check.
    body = {}
  }
  const hasPid = Number.isSafeInteger(body.pid) && (body.pid ?? 0) > 0
  const dead = hasPid && !pidAlive(body.pid!)
  const oldUnowned = !hasPid && Date.now() - before.mtimeMs > staleMs
  if (!dead && !oldUnowned) return false
  try {
    const now = await stat(lockPath)
    if (now.ino !== before.ino || now.mtimeMs !== before.mtimeMs) return false // someone re-took it: not ours to break
    await unlink(lockPath)
    return true
  } catch (error: any) {
    if (error?.code === 'ENOENT') return true // already gone
    if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'EBUSY') return false
    throw error
  }
}

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  const staleMs = opts.staleMs ?? 30_000
  const timeoutMs = opts.timeoutMs ?? 10_000
  const retryMs = opts.retryMs ?? 10
  const maxTimerMs = 2_147_483_647
  if (!Number.isSafeInteger(staleMs) || staleMs < 1 || staleMs > maxTimerMs) throw new RangeError('file lock: staleMs must be an integer from 1 to 2147483647')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > maxTimerMs) throw new RangeError('file lock: timeoutMs must be an integer from 0 to 2147483647')
  if (!Number.isSafeInteger(retryMs) || retryMs < 1 || retryMs > maxTimerMs) throw new RangeError('file lock: retryMs must be an integer from 1 to 2147483647')
  const token = randomBytes(8).toString('hex')
  const start = Date.now()

  for (;;) {
    try {
      const fh = await open(lockPath, 'wx')
      try {
        await fh.writeFile(JSON.stringify({ pid: process.pid, token, ts: Date.now() }), 'utf8')
      } finally {
        await fh.close()
      }
      break
    } catch (e: any) {
      if (e?.code !== 'EEXIST' && e?.code !== 'EPERM' && e?.code !== 'EACCES' && e?.code !== 'EBUSY') throw e
      if (await tryBreakStale(lockPath, staleMs)) continue
      if (Date.now() - start >= timeoutMs) throw new LockTimeoutError(lockPath, Date.now() - start)
      await sleep(Math.min(maxTimerMs, retryMs + Math.floor(Math.random() * retryMs)))
    }
  }

  try {
    return await fn()
  } finally {
    try {
      const held = JSON.parse(await readFile(lockPath, 'utf8')) as { token?: string }
      if (held.token === token) await unlink(lockPath)
    } catch {
      /* already gone or replaced: nothing of ours to remove */
    }
  }
}
