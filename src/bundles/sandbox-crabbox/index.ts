import { SandboxError, type SandboxDoctor, type SandboxProvider, type SandboxRunRequest, type SandboxRunResult } from '../sandbox/types.js'
import type { Subprocess } from '../subprocess/index.js'

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
  /** Max time for each crabbox control call (warmup, stop, list). Default 300000. */
  controlTimeoutMs?: number
  /** Extra env var NAMES copied from the process env to the crabbox process (PATH, HOME, DOCKER_HOST... are already included). */
  envAllowlist?: string[]
}

const BASE_ENV = ['PATH', 'HOME', 'USERPROFILE', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'XDG_CONFIG_HOME']
const LOCAL = new Set(['local-container', 'docker', 'container', 'local-docker'])

function slugId(): string {
  return `harness-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
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
  private readonly envNames: string[]

  constructor(private readonly subprocess: Subprocess, private readonly cfg: CrabboxConfig = {}) {
    this.provider = cfg.provider ?? 'local-container'
    this.bin = cfg.bin ?? 'crabbox'
    this.binArgs = cfg.binArgs ?? []
    this.controlTimeout = cfg.controlTimeoutMs ?? 300_000
    this.envNames = [...BASE_ENV, ...(cfg.envAllowlist ?? [])]
    this.destination = LOCAL.has(this.provider) ? 'local' : 'remote'
    if (this.destination === 'remote') this.host = cfg.host ?? this.provider
  }

  private cb(args: string[], timeoutMs: number, signal?: AbortSignal) {
    const env: Record<string, string> = {}
    for (const n of this.envNames) if (process.env[n] !== undefined) env[n] = process.env[n]!
    return this.subprocess.run(this.bin, [...this.binArgs, ...args], { envAllowlist: this.envNames, env, timeoutMs, signal })
  }

  async doctor(): Promise<SandboxDoctor> {
    const v = await this.cb(['--version'], 30_000)
    if (v.spawnError || v.exitCode !== 0) return { ok: false, detail: `crabbox not runnable: ${v.spawnError ?? (v.stderr.trim().slice(0, 200) || 'exit ' + v.exitCode)}` }
    const version = v.stdout.trim().split('\n')[0] ?? ''
    if (this.cfg.expectedVersion && !version.includes(this.cfg.expectedVersion)) {
      return { ok: false, detail: `crabbox version "${version}" does not match the pin "${this.cfg.expectedVersion}"` }
    }
    const d = await this.cb(['doctor', '--provider', this.provider], this.controlTimeout)
    return { ok: d.exitCode === 0, detail: `${version}; provider ${this.provider}; ${d.exitCode === 0 ? 'doctor ok' : (d.stderr || d.stdout).trim().slice(0, 200)}` }
  }

  async run(req: SandboxRunRequest): Promise<SandboxRunResult> {
    const slug = slugId()
    const start = Date.now()
    const warm = ['warmup', '--provider', this.provider, '--slug', slug]
    if (this.cfg.image && this.destination === 'local') warm.push('--local-container-image', this.cfg.image)
    if (this.cfg.runtime && this.destination === 'local') warm.push('--local-container-runtime', this.cfg.runtime)
    let leaseTried = false
    let rel: { released: boolean; note?: string } = { released: false, note: 'release not attempted' }
    let run: Awaited<ReturnType<CrabboxProvider['cb']>> | undefined
    try {
      leaseTried = true
      const w = await this.cb(warm, this.controlTimeout, req.signal)
      if (w.spawnError || w.exitCode !== 0) {
        throw new SandboxError('unreachable', `crabbox: could not lease a box (${w.spawnError ?? (w.stderr || w.stdout).trim().slice(0, 300)})`)
      }
      run = await this.cb(['run', '--provider', this.provider, '--id', slug, '--', ...req.command], req.timeoutMs ?? 0, req.signal)
    } finally {
      if (leaseTried) {
        rel = await this.release(slug)
      }
    }
    return {
      provider: this.name,
      leaseId: slug,
      exitCode: run!.exitCode,
      stdout: run!.stdout,
      stderr: run!.spawnError ? run!.spawnError : run!.stderr,
      timedOut: run!.timedOut,
      durationMs: Date.now() - start,
      released: rel.released,
      releaseNote: rel.note,
    }
  }

  /** Stop, then confirm via `list`. Retried once. Never throws: a failed release is reported, not hidden. */
  private async release(slug: string): Promise<{ released: boolean; note?: string }> {
    let note = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const s = await this.cb(['stop', '--provider', this.provider, slug], this.controlTimeout)
      const l = await this.cb(['list', '--provider', this.provider], this.controlTimeout)
      if (l.exitCode === 0 && !l.stdout.includes(slug)) return { released: true }
      note = l.exitCode !== 0 ? `could not confirm release: list failed (${(l.stderr || l.spawnError || '').trim().slice(0, 120)})` : `lease ${slug} still listed after stop (stop exit ${s.exitCode})`
    }
    return { released: false, note }
  }
}
