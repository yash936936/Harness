import { Context, Service } from 'cordis'
import { type ChildProcess, spawn } from 'node:child_process'
import { SubprocessError, type RunOptions, type RunResult, type SubprocessConfig } from './types.js'

export * from './types.js'

declare module 'cordis' {
  interface Context {
    subprocess: Subprocess
  }
}

const DEFAULT_MAX_OUTPUT = 1_000_000
const DEFAULT_KILL_GRACE_MS = 2000
const WINDOWS = process.platform === 'win32'

/**
 * Every live child's pid. On POSIX a child is started as the leader of its own process group so the
 * whole tree can be signalled at once (BUG-02); a group is not killed when this process exits, so any
 * still running at exit are killed here rather than left behind modifying files.
 */
const live = new Set<number>()
process.once('exit', () => {
  for (const pid of live) signalTree(pid, 'SIGKILL')
})

/** Signal a child and all its descendants. Best effort: the tree may already be gone. */
function signalTree(pid: number, signal: NodeJS.Signals): void {
  try {
    if (WINDOWS) {
      // `taskkill /T` walks the tree; /F because Windows has no graceful signal for a console child.
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {})
    } else {
      process.kill(-pid, signal) // negative pid = the whole process group
    }
  } catch {
    /* ESRCH: already exited */
  }
}

/**
 * `ctx.subprocess` — local command execution for v1 (`docs/architecture.md`
 * `bundle-subprocess`). No shell, no implicit environment: a command runs
 * with exactly the env vars its caller allowlisted, nothing inherited by
 * default. This is what 1.4's security requirement asks for, and it also
 * means a wrapped or aliased command can't reach a secret the allowlist
 * didn't name — same principle the deny-list guardrail (D-006) will later
 * rely on at the policy-gates layer.
 *
 * A command failing (non-zero exit, signal, timeout, or not found at all) is
 * a normal `RunResult`, not a thrown error — the same "expected failures
 * come back, not throw" choice `tool-registry` makes, since a future tool
 * wrapping this needs the exit code and stderr to hand back to the model,
 * not a caught exception. `SubprocessError` is reserved for a caller mistake
 * (an unlisted env key) caught before anything spawns.
 */
export class Subprocess extends Service {
  private readonly cwd: string
  private readonly baseAllowlist: Set<string>
  private readonly defaultTimeoutMs: number
  private readonly defaultMaxOutput: number

  constructor(ctx: Context, config: SubprocessConfig = {}) {
    super(ctx, 'subprocess')
    this.cwd = config.cwd ?? process.cwd()
    const allowlist = config.envAllowlist ?? []
    if (!Array.isArray(allowlist) || allowlist.some((key) => typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) {
      throw new SubprocessError('config', 'subprocess: envAllowlist must contain valid environment variable names')
    }
    this.baseAllowlist = new Set(allowlist)
    this.defaultTimeoutMs = config.timeoutMs ?? 0
    this.defaultMaxOutput = config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT
    if (!Number.isSafeInteger(this.defaultTimeoutMs) || this.defaultTimeoutMs < 0) throw new SubprocessError('config', 'subprocess: timeoutMs must be a non-negative safe integer (0 disables the timeout)')
    if (!Number.isSafeInteger(this.defaultMaxOutput) || this.defaultMaxOutput < 0) throw new SubprocessError('config', 'subprocess: maxOutputBytes must be a non-negative safe integer')
  }

  /** Run `command` with `args`. Never throws for a failure the caller needs to see — see the class doc. */
  async run(command: string, args: string[] = [], opts: RunOptions = {}): Promise<RunResult> {
    const cwd = opts.cwd ?? this.cwd
    const allowlist = opts.envAllowlist?.length ? new Set([...this.baseAllowlist, ...opts.envAllowlist]) : this.baseAllowlist

    for (const key of Object.keys(opts.env ?? {})) {
      if (!allowlist.has(key)) {
        throw new SubprocessError(
          'config',
          `subprocess: env var "${key}" is not in the allowlist for this call. ` +
            `Add it to \`envAllowlist\` (bundle config or this call's options) or remove it from \`env\`.`,
        )
      }
    }

    const env: NodeJS.ProcessEnv = {}
    for (const key of allowlist) {
      const v = opts.env && key in opts.env ? opts.env[key] : process.env[key]
      if (v !== undefined) env[key] = v
    }

    const maxOutput = opts.maxOutputBytes ?? this.defaultMaxOutput
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs
    const killGraceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS
    if (!Number.isSafeInteger(maxOutput) || maxOutput < 0) throw new SubprocessError('config', 'subprocess: maxOutputBytes must be a non-negative safe integer')
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) throw new SubprocessError('config', 'subprocess: timeoutMs must be a non-negative safe integer')
    if (!Number.isSafeInteger(killGraceMs) || killGraceMs < 0) throw new SubprocessError('config', 'subprocess: killGraceMs must be a non-negative safe integer')
    if (typeof command !== 'string' || !command.trim() || !Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      throw new SubprocessError('config', 'subprocess: command must be non-empty and args must be strings')
    }
    const start = Date.now()

    // BUG-01: a task that was already cancelled must not launch anything at all.
    if (opts.signal?.aborted) {
      return {
        command, args, cwd, exitCode: null, signal: null, stdout: '', stderr: '',
        stdoutTruncated: false, stderrTruncated: false, timedOut: false, aborted: true, durationMs: 0,
      }
    }

    return new Promise<RunResult>((resolve) => {
      // Declared BEFORE the spawn: a synchronous spawn failure calls finish(), which reads these (a use-before-declaration bug, found on Windows, D-082).
      let settled = false
      let timedOut = false
      let aborted = false
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let stdoutBytes = 0
      let stderrBytes = 0
      let stdoutTruncated = false
      let stderrTruncated = false

      let child: ChildProcess
      try {
        child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, detached: !WINDOWS })
      } catch (e: any) {
        // Some invalid inputs (e.g. a command containing a NUL byte) throw synchronously
        // instead of emitting 'error'. Treat the same as a spawn failure either way.
        resolve(finish({ spawnError: e?.message ?? String(e) }))
        return
      }

      const collect = (chunks: Buffer[], data: Buffer, bytes: number, truncated: boolean) => {
        if (truncated) return { bytes, truncated }
        const room = maxOutput - bytes
        if (room <= 0) return { bytes, truncated: true }
        const piece = data.byteLength > room ? data.subarray(0, room) : data
        chunks.push(Buffer.from(piece))
        const newBytes = bytes + piece.byteLength
        return { bytes: newBytes, truncated: piece.byteLength < data.byteLength }
      }

      child.stdout?.on('data', (d: Buffer) => {
        const r = collect(stdoutChunks, d, stdoutBytes, stdoutTruncated)
        stdoutBytes = r.bytes
        stdoutTruncated = r.truncated
      })
      child.stderr?.on('data', (d: Buffer) => {
        const r = collect(stderrChunks, d, stderrBytes, stderrTruncated)
        stderrBytes = r.bytes
        stderrTruncated = r.truncated
      })

      const pid = child.pid
      if (pid !== undefined) live.add(pid)
      const timers: NodeJS.Timeout[] = []

      /** SIGTERM the tree now, SIGKILL it after the grace period, and give up waiting shortly after that. */
      const terminate = () => {
        if (pid === undefined) return
        signalTree(pid, 'SIGTERM')
        timers.push(setTimeout(() => signalTree(pid, 'SIGKILL'), killGraceMs))
        // If a descendant still holds our pipes open, 'close' never fires; do not hang the caller on it.
        timers.push(
          setTimeout(() => {
            if (settled) return
            settled = true
            cleanup()
            resolve(finish({ exitCode: child.exitCode, signal: child.signalCode }))
          }, killGraceMs + 1000),
        )
      }

      if (timeoutMs > 0) {
        timers.push(
          setTimeout(() => {
            timedOut = true
            terminate()
          }, timeoutMs),
        )
      }

      const onAbort = () => {
        aborted = true
        terminate()
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      const cleanup = () => {
        for (const t of timers) clearTimeout(t)
        opts.signal?.removeEventListener('abort', onAbort)
        if (pid !== undefined) {
          live.delete(pid)
          // The process we started is finished; nothing it left running may outlive the call.
          if (timedOut || aborted || !WINDOWS) signalTree(pid, 'SIGKILL')
        }
      }

      function finish(partial: Partial<RunResult>): RunResult {
        return {
          command,
          args,
          cwd,
          exitCode: null,
          signal: null,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          stdoutTruncated,
          stderrTruncated,
          timedOut,
          aborted,
          durationMs: Date.now() - start,
          ...partial,
        }
      }

      child.once('error', (e) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(finish({ spawnError: e.message }))
      })

      child.once('close', (code, signal) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(finish({ exitCode: code, signal }))
      })
    })
  }
}

export const name = 'bundle-subprocess'
export function apply(ctx: Context, config: SubprocessConfig = {}) {
  ctx.plugin(Subprocess, config)
}
