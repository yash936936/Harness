/** Vercel Sandbox remote provider adapter. */
import { SandboxError, type SandboxDoctor, type SandboxProvider, type SandboxRunRequest, type SandboxRunResult } from '../sandbox/types.js'

/**
 * Minimal structural surface of @vercel/sandbox. Keeping the SDK behind this
 * interface lets tests exercise lifecycle and policy without cloud credentials.
 */
export interface VercelSandboxHandle {
  name?: string
  runCommand(options: {
    cmd: string
    args: string[]
    cwd?: string
    timeoutMs?: number
    signal?: AbortSignal
  }): Promise<{
    exitCode: number | null
    stdout(): Promise<string>
    stderr(): Promise<string>
  }>
  delete(): Promise<void>
}

export interface VercelSandboxClient {
  create(options: {
    persistent: false
    networkPolicy: 'deny-all'
    timeout: number
    signal?: AbortSignal
  }): Promise<VercelSandboxHandle>
}

export interface VercelSandboxConfig {
  /** Injected SDK client for tests or controlled integrations. */
  client?: VercelSandboxClient
  /** Maximum sandbox session lifetime. Defaults to 10 minutes. */
  sandboxTimeoutMs?: number
  /** Maximum captured bytes per output stream. Defaults to 100 KB. */
  maxOutputBytes?: number
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('aborted'))
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => { cleanup(); reject(signal.reason ?? new Error('aborted')) }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    promise.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
  })
}

async function loadClient(): Promise<VercelSandboxClient> {
  let mod: any
  try {
    mod = await import('@vercel/sandbox' as string)
  } catch {
    throw new SandboxError('config', 'vercel-sandbox: install @vercel/sandbox and configure Vercel authentication before selecting this provider')
  }
  if (!mod?.Sandbox || typeof mod.Sandbox.create !== 'function') {
    throw new SandboxError('config', 'vercel-sandbox: installed SDK does not expose Sandbox.create')
  }
  // Use the explicit access-token path so the SDK does not need to discover or refresh
  // ambient CLI/OIDC credentials through additional hosts. Never pass this token to the guest.
  const token = process.env.VERCEL_TOKEN
  const teamId = process.env.VERCEL_TEAM_ID
  const projectId = process.env.VERCEL_PROJECT_ID
  if (!token || !teamId || !projectId) {
    throw new SandboxError('config', 'vercel-sandbox: set VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID in the host environment')
  }
  return { create: (options) => mod.Sandbox.create({ ...options, token, teamId, projectId }) }
}

/**
 * Remote Vercel Firecracker provider. Every invocation creates a fresh,
 * non-persistent microVM with deny-all network policy and deletes it in finally.
 *
 * Project transfer is intentionally not implemented here. The provider is not
 * enabled by the coding CLI until a separately reviewed, secret-safe workspace
 * snapshot and result-sync contract is implemented.
 */
export class VercelSandboxProvider implements SandboxProvider {
  readonly name = 'vercel'
  readonly destination = 'remote' as const
  readonly host = 'vercel.com'
  private client: VercelSandboxClient | undefined

  constructor(private readonly cfg: VercelSandboxConfig = {}) {
    if (cfg.sandboxTimeoutMs !== undefined &&
        (!Number.isSafeInteger(cfg.sandboxTimeoutMs) || cfg.sandboxTimeoutMs < 1 || cfg.sandboxTimeoutMs > 86_400_000)) {
      throw new SandboxError('config', 'vercel-sandbox: sandboxTimeoutMs must be an integer from 1 to 86400000')
    }
    if (cfg.maxOutputBytes !== undefined && (!Number.isSafeInteger(cfg.maxOutputBytes) || cfg.maxOutputBytes < 1)) {
      throw new SandboxError('config', 'vercel-sandbox: maxOutputBytes must be a positive safe integer')
    }
    if (cfg.client !== undefined && typeof cfg.client.create !== 'function') {
      throw new SandboxError('config', 'vercel-sandbox: client must implement create')
    }
    this.client = cfg.client
  }

  private async getClient(): Promise<VercelSandboxClient> {
    return (this.client ??= await loadClient())
  }

  async doctor(): Promise<SandboxDoctor> {
    try {
      const result = await this.run({ command: ['true'], timeoutMs: 30_000 })
      return {
        ok: result.released && result.exitCode === 0,
        detail: result.released
          ? `created and deleted ephemeral sandbox ${result.leaseId}`
          : `sandbox ${result.leaseId} may remain: ${result.releaseNote ?? 'delete was not confirmed'}`,
      }
    } catch (error) {
      return { ok: false, detail: String((error as any)?.message ?? error).slice(0, 240) }
    }
  }

  async run(req: SandboxRunRequest): Promise<SandboxRunResult> {
    req.signal?.throwIfAborted()
    if (!Array.isArray(req.command) || req.command.length === 0 ||
        req.command.some((part) => typeof part !== 'string' || part.includes('\0')) ||
        !req.command[0]!.trim()) {
      throw new SandboxError('config', 'vercel-sandbox: command must be a non-empty argv array without NUL bytes')
    }
    const timeoutMs = req.timeoutMs ?? 60_000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new SandboxError('config', 'vercel-sandbox: timeoutMs must be a positive safe integer')
    }

    const started = Date.now()
    const client = await raceAbort(this.getClient(), req.signal)
    let create: Promise<VercelSandboxHandle> | undefined
    let sandbox: VercelSandboxHandle
    try {
      create = Promise.resolve(client.create({
        persistent: false,
        networkPolicy: 'deny-all',
        timeout: Math.min(this.cfg.sandboxTimeoutMs ?? 600_000, Math.max(timeoutMs + 30_000, 60_000)),
        ...(req.signal ? { signal: req.signal } : {}),
      }))
      sandbox = await raceAbort(create, req.signal)
    } catch (error) {
      if (req.signal?.aborted) {
        // Sandbox.create may not be cancellable in every SDK release. Delete a late handle.
        if (create) void create.then((late) => late.delete()).catch(() => {})
        throw req.signal.reason ?? error
      }
      throw new SandboxError('unreachable', `vercel-sandbox: sandbox creation failed (${String((error as any)?.message ?? error).slice(0, 240)})`)
    }

    const leaseId = String(sandbox.name ?? 'vercel-sandbox-unknown')
    let exitCode: number | null = null
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let commandError: unknown
    let released = false
    let releaseNote: string | undefined

    try {
      const command = await raceAbort(sandbox.runCommand({
        cmd: req.command[0]!,
        args: req.command.slice(1),
        ...(req.cwd ? { cwd: req.cwd } : {}),
        timeoutMs,
        ...(req.signal ? { signal: req.signal } : {}),
      }), req.signal)
      exitCode = command.exitCode
      ;[stdout, stderr] = await raceAbort(Promise.all([command.stdout(), command.stderr()]), req.signal)
    } catch (error) {
      if (req.signal?.aborted) commandError = req.signal.reason ?? error
      else {
        const message = String((error as any)?.message ?? error)
        timedOut = /timeout|timed out|deadline/i.test(message)
        stderr = message.slice(0, 1000)
      }
    } finally {
      try {
        await sandbox.delete()
        released = true
      } catch (error) {
        releaseNote = `delete failed: ${String((error as any)?.message ?? error).slice(0, 180)}`
      }
    }

    const outputLimit = this.cfg.maxOutputBytes ?? 100_000
    const bound = (value: string) => {
      let bytes = 0
      let out = ''
      for (const char of value) {
        const size = Buffer.byteLength(char, 'utf8')
        if (bytes + size > outputLimit) return out + '\n[output truncated by Vercel provider]'
        out += char
        bytes += size
      }
      return out
    }
    stdout = bound(stdout)
    stderr = bound(stderr)

    if (commandError) {
      const error = commandError instanceof Error ? commandError : new Error(String(commandError))
      if (!released) error.message += `; sandbox ${leaseId} deletion was not confirmed: ${releaseNote}`
      throw error
    }

    return {
      provider: this.name,
      leaseId,
      exitCode,
      stdout,
      stderr,
      timedOut,
      durationMs: Date.now() - started,
      released,
      ...(releaseNote ? { releaseNote } : {}),
    }
  }
}
