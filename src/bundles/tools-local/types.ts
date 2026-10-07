export interface LocalToolsConfig {
  /** The project root. Every path the tools touch must resolve (symlinks followed) to somewhere inside it. Default: `process.cwd()`. Must exist. */
  root?: string
  /** `read_file` returns at most this many characters per call. Default 40000. */
  maxReadChars?: number
  /** Files larger than this are refused by `read_file` and `edit_file`. Default 1,000,000 bytes. */
  maxFileBytes?: number
  /** `run_command` timeout when the model gives none, in seconds. Default 60. */
  commandTimeoutSeconds?: number
  /** The most a model may ask for as a `run_command` timeout, in seconds. Default 600. */
  maxCommandTimeoutSeconds?: number
  /** Captured output cap per stream for `run_command`, in bytes. Default 100,000. */
  maxCommandOutputBytes?: number
  /** Environment variable NAMES a command may see. Default `['PATH']` (without it nothing resolves on POSIX). Nothing else is inherited. */
  envAllowlist?: string[]
  /** Let `read_file` open `.env*`, key and credential files. Default false. */
  allowSecretReads?: boolean
}

/** Programmer error (bad config), not a tool outcome. */
export class LocalToolsConfigError extends Error {
  override name = 'LocalToolsConfigError'
}
