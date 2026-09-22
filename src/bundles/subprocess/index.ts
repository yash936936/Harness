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
    this.baseAllowlist = new Set(config.envAllowlist ?? [])
    this.defaultTimeoutMs = config.timeoutMs ?? 0
    this.defaultMaxOutput = config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT
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
    const start = Date.now()

    return new Promise<RunResult>((resolve) => {
      let child: ChildProcess
      try {
        child = spawn(command, args, { cwd, env, shell: false, windowsHide: true })
      } catch (e: any) {
        // Some invalid inputs (e.g. a command containing a NUL byte) throw synchronously
        // instead of emitting 'error'. Treat the same as a spawn failure either way.
        resolve(finish({ spawnError: e?.message ?? String(e) }))
        return
      }

      let settled = false
      let timedOut = false
      let aborted = false
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let stdoutBytes = 0
      let stderrBytes = 0
      let stdoutTruncated = false
      let stderrTruncated = false

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

      let timer: NodeJS.Timeout | undefined
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true
          child.kill('SIGTERM')
        }, timeoutMs)
      }

      const onAbort = () => {
        aborted = true
        child.kill('SIGTERM')
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      const cleanup = () => {
        if (timer) clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
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
