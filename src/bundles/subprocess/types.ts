export interface SubprocessConfig {
  /** Default working directory for `run()`. Defaults to `process.cwd()`, overridable per call. */
  cwd?: string
  /**
   * Names of environment variables visible to a spawned process. Everything
   * else is stripped — including `PATH`, `SystemRoot`, etc. There is no
   * implicit base set, by design (the 1.4 security requirement): if a
   * command needs `PATH` to resolve, the caller allowlists it explicitly.
   */
  envAllowlist?: string[]
  /** Default per-call timeout in ms. Omit or 0 to disable by default (still overridable per call). */
  timeoutMs?: number
  /** Default captured-output cap per stream, in bytes. Default 1,000,000. */
  maxOutputBytes?: number
}

export interface RunOptions {
  /** Overrides the bundle's default `cwd` for this call. */
  cwd?: string
  /** Extra names allowlisted for this call only, in addition to the bundle's own list. */
  envAllowlist?: string[]
  /**
   * Values to set in the child's environment for this call. Every key here
   * must be in the combined allowlist (config + `envAllowlist` above); an
   * unlisted key throws `SubprocessError('config')` before anything spawns,
   * rather than silently dropping it.
   */
  env?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
  maxOutputBytes?: number
}

export interface RunResult {
  command: string
  args: string[]
  cwd: string
  /** `null` when the process was killed by a signal, or never started (see `spawnError`). */
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  /** True if stdout was cut off at `maxOutputBytes`. */
  stdoutTruncated: boolean
  stderrTruncated: boolean
  /** True if the run was killed for exceeding `timeoutMs`. */
  timedOut: boolean
  /** True if the run was killed because `signal` (the AbortSignal) fired. */
  aborted: boolean
  /**
   * Set when the process could not be started at all (bad command, no
   * permission, etc. — Node's `error` event). `exitCode` and `signal` are
   * both `null` in that case. This is a call outcome, not a thrown error:
   * see the class doc for why.
   */
  spawnError?: string
  durationMs: number
}

export type SubprocessErrorKind = 'config'

/** Only for caller mistakes caught before a process is spawned (e.g. an unlisted env key). */
export class SubprocessError extends Error {
  override name = 'SubprocessError'
  constructor(public kind: SubprocessErrorKind, message: string) {
    super(message)
  }
}
