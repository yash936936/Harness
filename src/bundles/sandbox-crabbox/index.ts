import { SandboxError, type SandboxDoctor, type SandboxProvider, type SandboxRunRequest, type SandboxRunResult } from '../sandbox/types.js'
import type { Subprocess } from '../subprocess/index.js'
import { randomBytes } from 'node:crypto'

export interface CrabboxConfig {
  /** Crabbox provider. D-024: direct, local-container or static-SSH only; the hosted broker is not available to this project. Default `local-container`. */
  provider?: string
  /** The crabbox executable. Default `crabbox`. */
  bin?: string
  /** Arguments placed before every crabbox subcommand (used by tests to run a fake via `node fake.mjs`). */
  binArgs?: string[]
  /** For a non-local provider: the host the lease is reached at (checked against the egress allowlist). Default: the provider name. */
  host?: string
  /** local-container runtime (`--local-container-runtime`): `docker` or `podman`. Omitted = crabbox decides. Windows guide's own smoke passes `docker`. */
  runtime?: string
  /** Image for local-container (`--local-container-image`). */
  image?: string
  /** Pin (D-024: crabbox is pre-1.0). If set, `doctor` fails unless `crabbox --version` contains this string. */
  expectedVersion?: string
  /** Max time for warmup and other lease-control calls. Default 300000. */
  controlTimeoutMs?: number
  /** Max time for doctor checks. Default 45000. */
  doctorTimeoutMs?: number
  /** Overall budget for stop/list cleanup, including the retry. Default 15000. */
  cleanupTimeoutMs?: number
  /**
   * Directory the crabbox CLI is started in. `crabbox run` syncs the CURRENT checkout into the box (docs/commands/run.md), so this
   * decides which tree the sandbox sees. `profile-coding` sets it to the project root; without it the subprocess default (the
   * harness process's own cwd) is used, which may be a different project or the harness repo itself.
   */
  cwd?: string
  /** Extra env var NAMES copied from the process env to the crabbox process (PATH, HOME, DOCKER_HOST... are already included). */
  envAllowlist?: string[]
}

const BASE_ENV = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']
const LOCAL = new Set(['local-container', 'docker', 'container', 'local-docker'])

function slugId(): string {
  return `harness-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`
}

/**
 * `ctx.sandbox` provider `crabbox` (5.1). Drives the Crabbox CLI as a subprocess. One call = one explicit lease:
 * `warmup` (lease) -> `run --id` -> `stop` in a `finally` -> `list` to CONFIRM the lease is gone. A one-shot
 * `crabbox run` would release by itself, but the explicit flow is what lets a failed or aborted run still
 * be cleaned up and lets us report `released` truthfully instead of assuming it.
 *
 * UNVERIFIED against a real crabbox: written from its public README/docs and tested with a fake CLI. Flags used:
 * `warmup --provider --slug`, `run --provider --id -- <cmd>`, `stop --provider <slug>`, `list --provider`, `doctor --provider`.
 */
export class CrabboxProvider implements SandboxProvider {
  readonly name = 'crabbox'
  readonly destination: 'local' | 'remote'
  readonly host?: string
  private readonly provider: string
  private readonly bin: string
  private readonly binArgs: string[]
  private readonly controlTimeout: number
  private readonly doctorTimeout: number
  private readonly cleanupTimeout: number
  private readonly envNames: string[]
  private readonly cwd?: string

  constructor(private readonly subprocess: Subprocess, private readonly cfg: CrabboxConfig = {}) {
    this.provider = cfg.provider ?? 'local-container'
    this.bin = cfg.bin ?? 'crabbox'
    this.binArgs = cfg.binArgs ?? []
    this.controlTimeout = cfg.controlTimeoutMs ?? 300_000
    this.doctorTimeout = cfg.doctorTimeoutMs ?? 45_000
    this.cleanupTimeout = cfg.cleanupTimeoutMs ?? 15_000
    const extraEnv = cfg.envAllowlist ?? []
    if (typeof this.provider !== 'string' || !this.provider.trim()) throw new SandboxError('config', 'crabbox: provider must be a non-empty string')
    if (typeof this.bin !== 'string' || !this.bin.trim()) throw new SandboxError('config', 'crabbox: bin must be a non-empty executable')
    if (!Array.isArray(this.binArgs) || this.binArgs.some((arg) => typeof arg !== 'string')) throw new SandboxError('config', 'crabbox: binArgs must be strings')
    if (!Number.isSafeInteger(this.controlTimeout) || this.controlTimeout < 1) throw new SandboxError('config', 'crabbox: controlTimeoutMs must be a positive safe integer')
    if (!Number.isSafeInteger(this.doctorTimeout) || this.doctorTimeout < 1) throw new SandboxError('config', 'crabbox: doctorTimeoutMs must be a positive safe integer')
    if (!Number.isSafeInteger(this.cleanupTimeout) || this.cleanupTimeout < 1) throw new SandboxError('config', 'crabbox: cleanupTimeoutMs must be a positive safe integer')
    if (!Array.isArray(extraEnv) || extraEnv.some((key) => typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) throw new SandboxError('config', 'crabbox: envAllowlist must contain valid environment variable names')
    if (cfg.runtime !== undefined && !['docker', 'podman'].includes(cfg.runtime)) throw new SandboxError('config', 'crabbox: runtime must be docker or podman')
    if (cfg.image !== undefined && (typeof cfg.image !== 'string' || !cfg.image.trim())) throw new SandboxError('config', 'crabbox: image must be a non-empty string')
    if (cfg.expectedVersion !== undefined && (typeof cfg.expectedVersion !== 'string' || !cfg.expectedVersion.trim())) throw new SandboxError('config', 'crabbox: expectedVersion must be non-empty when supplied')
    if (cfg.cwd !== undefined && (typeof cfg.cwd !== 'string' || !cfg.cwd.trim())) throw new SandboxError('config', 'crabbox: cwd must be a non-empty path')
    this.envNames = [...new Set([...BASE_ENV, ...extraEnv])]
    this.cwd = cfg.cwd
    this.destination = LOCAL.has(this.provider) ? 'local' : 'remote'
    if (this.destination === 'remote') this.host = cfg.host ?? this.provider
  }

  private cb(args: string[], timeoutMs: number, signal?: AbortSignal) {
    const env: Record<string, string> = {}
    for (const n of this.envNames) if (process.env[n] !== undefined) env[n] = process.env[n]!
    return this.subprocess.run(this.bin, [...this.binArgs, ...args], { envAllowlist: this.envNames, env, timeoutMs, signal, ...(this.cwd ? { cwd: this.cwd } : {}) })
  }

  async doctor(): Promise<SandboxDoctor> {
    const v = await this.cb(['--version'], 30_000)
    if (v.spawnError || v.exitCode !== 0) return { ok: false, detail: `crabbox not runnable: ${v.spawnError ?? (v.stderr.trim().slice(0, 200) || 'exit ' + v.exitCode)}` }
    const version = v.stdout.trim().split('\n')[0] ?? ''
    if (this.cfg.expectedVersion && !version.includes(this.cfg.expectedVersion)) {
      return { ok: false, detail: `crabbox version "${version}" does not match the pin "${this.cfg.expectedVersion}"` }
    }
    const dargs = ['doctor', '--provider', this.provider]
    if (this.cfg.runtime && this.destination === 'local') dargs.push('--local-container-runtime', this.cfg.runtime)
    const d = await this.cb(dargs, this.doctorTimeout)
    // Crabbox prints the failing checks on stdout and only a summary on stderr: keep BOTH, or the real reason is hidden.
    const out = [d.stdout.trim(), d.stderr.trim()].filter(Boolean).join('\n').slice(0, 1500)
    return { ok: d.exitCode === 0, detail: `${version}; provider ${this.provider}; ${d.timedOut ? 'doctor timed out' : d.exitCode === 0 ? 'doctor ok' : 'doctor failed:\n' + out}` }
  }

  async run(req: SandboxRunRequest): Promise<SandboxRunResult> {
    req.signal?.throwIfAborted()
    const slug = slugId()
    const start = Date.now()
    const warm = ['warmup', '--provider', this.provider, '--slug', slug]
    if (this.cfg.image && this.destination === 'local') warm.push('--local-container-image', this.cfg.image)
    if (this.cfg.runtime && this.destination === 'local') warm.push('--local-container-runtime', this.cfg.runtime)
    let leaseTried = false
    let rel: { released: boolean; note?: string } = { released: false, note: 'release not attempted' }
    let run: Awaited<ReturnType<CrabboxProvider['cb']>> | undefined
    // Crabbox normalizes a requested slug and may add a suffix (docs/commands/warmup.md), so the id used for run/stop is read back
    // from warmup's own output when it says one, and release is confirmed against EVERY name the lease might be listed under.
    let leaseId = slug
    const names = new Set<string>([slug])
    try {
      leaseTried = true
      const w = await this.cb(warm, this.controlTimeout, req.signal)
      if (req.signal?.aborted) throw req.signal.reason ?? new Error('aborted')
      if (w.spawnError || w.exitCode !== 0) {
        throw new SandboxError('unreachable', `crabbox: could not lease a box (${w.spawnError ?? (w.stderr || w.stdout).trim().slice(0, 300)})`)
      }
      const said = (w.stdout + '\n' + w.stderr).match(/slug=(\S+)/)?.[1]
      const cbx = (w.stdout + '\n' + w.stderr).match(/\bcbx_[0-9a-f]{12}\b/)?.[0]
      if (said) names.add(said)
      if (cbx) names.add(cbx)
      leaseId = said ?? slug
      run = await this.cb(['run', '--provider', this.provider, '--id', leaseId, '--', ...req.command], req.timeoutMs ?? 0, req.signal)
      if (req.signal?.aborted) throw req.signal.reason ?? new Error('aborted')
    } finally {
      if (leaseTried) {
        rel = await this.release(leaseId, names)
      }
    }
    if (req.signal?.aborted) throw req.signal.reason ?? new Error('aborted')
    return {
      provider: this.name,
      leaseId,
      exitCode: run!.exitCode,
      ...(run!.spawnError ? { spawnError: run!.spawnError } : {}),
      stdout: run!.stdout,
      stderr: run!.spawnError ? run!.spawnError : run!.stderr,
      timedOut: run!.timedOut,
      durationMs: Date.now() - start,
      released: rel.released,
      releaseNote: rel.note,
    }
  }

  /**
   * Stop, then confirm via `list`. Retried once. Never throws: a failed release is reported, not hidden.
   * Released means BOTH that `stop` exited 0 AND that `list` no longer shows the lease under any name it could have. Trusting `list`
   * alone would report a leak as released whenever `list` prints a different identifier than the one we looked for.
   */
  private async release(id: string, names: Set<string>): Promise<{ released: boolean; note?: string }> {
    let note = ''
    const deadline = Date.now() + this.cleanupTimeout
    for (let attempt = 0; attempt < 2 && Date.now() < deadline; attempt++) {
      let stop: Awaited<ReturnType<CrabboxProvider['cb']>> | undefined
      let list: Awaited<ReturnType<CrabboxProvider['cb']>> | undefined
      const remaining = () => Math.max(1, deadline - Date.now())
      try { stop = await this.cb(['stop', '--provider', this.provider, id], remaining()) }
      catch (error: any) { note = `stop threw: ${String(error?.message ?? error).slice(0, 120)}` }
      if (Date.now() >= deadline) {
        note = 'cleanup budget exhausted during stop'
        break
      }
      try { list = await this.cb(['list', '--provider', this.provider], remaining()) }
      catch (error: any) { note = `list threw: ${String(error?.message ?? error).slice(0, 120)}` }
      if (!list) continue
      const stillListed = [...names].some((name) => list!.stdout.includes(name))
      if (stop?.exitCode === 0 && !stop.spawnError && list.exitCode === 0 && !stillListed) return { released: true }
      note = list.exitCode !== 0
        ? `could not confirm release: list failed (${(list.stderr || list.spawnError || '').trim().slice(0, 120)})`
        : stillListed
          ? `lease ${id} still listed after stop (stop exit ${stop?.exitCode ?? 'threw'})`
          : `stop failed (exit ${stop?.exitCode ?? 'threw'}${stop?.spawnError ? ', ' + stop.spawnError : ''}): ${(stop?.stderr || stop?.stdout || '').trim().slice(0, 120)}`
    }
    return { released: false, note }
  }
}
