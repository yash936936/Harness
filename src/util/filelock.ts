import { open, readFile, stat, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'

/**
 * A cross-process advisory lock on a path (BUG-07, BUG-09). The in-process queues the stores use serialise callers inside ONE
 * process; two harness processes sharing a directory need the filesystem to arbitrate. The lock is a file created exclusively
 * (`wx`, atomic on local filesystems) holding the owner's pid and a random token.
 *
 * - A held lock is waited for up to `timeoutMs`, then `LockTimeoutError` is thrown. Never a silent skip: proceeding unlocked
 *   is exactly the corruption this prevents.
 * - A lock is STALE if its owner pid is gone, or it has not been touched for `staleMs`; a stale lock is broken so a crashed
 *   process cannot wedge everyone. The break re-checks identity right before deleting so a lock that was just re-taken is not
 *   removed (a window of microseconds remains; see below).
 * - Release deletes the file only if it still carries OUR token.
 *
 * Limits, stated plainly: advisory (only code that takes the lock is excluded); assumes one machine and a local filesystem
 * (pid liveness is meaningless across hosts and `wx` is not reliable on some network filesystems); a process stalled for longer
 * than `staleMs` while holding the lock can lose it, so `staleMs` must exceed the longest critical section (these are file appends).
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
  } catch {
    return true // vanished between our attempts: just retry
  }
  try {
    body = JSON.parse(await readFile(lockPath, 'utf8'))
  } catch {
    // Present but empty or half-written: its owner is either mid-write (young: keep waiting) or died between creating and writing it
    // (old: it must be breakable, or one crash wedges the lock for good). Judged by age below, with no pid to check.
    body = {}
  }
  const dead = typeof body.pid === 'number' && !pidAlive(body.pid)
  const old = Date.now() - before.mtimeMs > staleMs
  if (!dead && !old) return false
  try {
    const now = await stat(lockPath)
    if (now.ino !== before.ino || now.mtimeMs !== before.mtimeMs) return false // someone re-took it: not ours to break
    await unlink(lockPath)
    return true
  } catch {
    return true // already gone
  }
}

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  const staleMs = opts.staleMs ?? 30_000
  const timeoutMs = opts.timeoutMs ?? 10_000
  const retryMs = opts.retryMs ?? 10
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
      await sleep(retryMs + Math.floor(Math.random() * retryMs))
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
