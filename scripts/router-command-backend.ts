/**
 * Explicit evaluation-only adapter for comparing a local external router executable.
 * This file lives under scripts/, not the runtime router bundle. Never import it from a profile.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import type { Candidate, DecisionClass, RouterBackend } from '../src/bundles/router/types.js'

export interface CommandBackendConfig {
  /** Executable that speaks the stdio contract below. For Needle this is a thin wrapper YOU supply and verify (see docs). */
  command: string
  args?: string[]
  /** Files that must exist for the backend to count as installed. Missing = skipped silently (the delete-Needle case). */
  requiredFiles?: string[]
  /** If set, the first required file must hash to this, checked once (streamed). A mismatch disables the backend. */
  expectedSha256?: string
  timeoutMs?: number
  name?: 'needle'
}

export async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw signal.reason ?? new Error('aborted')
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    const finish = (error?: Error) => {
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = () => stream.destroy(signal?.reason instanceof Error ? signal.reason : new Error('aborted'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    stream.on('data', (data) => hash.update(data))
    stream.once('end', () => finish())
    stream.once('error', (error) => finish(error))
  })
  return hash.digest('hex')
}
/**
 * Talks to an external process: one JSON line in `{"class","task","candidates":[{"id","description"}]}`, one JSON line out
 * `{"choice":"<id>"|null}`, then it exits. A hang is killed at the timeout. Nothing here assumes how Needle is run:
 * the wrapper that loads the model is outside this repo, and the Cactus runtime's real interface is unverified (D-050).
 */
export class CommandBackend implements RouterBackend {
  readonly name: 'needle'
  private verified: { ok: boolean; why?: string } | undefined

  constructor(private readonly cfg: CommandBackendConfig) {
    this.name = cfg.name ?? 'needle'
    if (typeof cfg.command !== 'string' || !cfg.command.trim()) throw new Error('router backend: command is required')
    if (cfg.args !== undefined && (!Array.isArray(cfg.args) || cfg.args.some((arg) => typeof arg !== 'string'))) throw new Error('router backend: args must be strings')
    if (cfg.requiredFiles !== undefined && (!Array.isArray(cfg.requiredFiles) || cfg.requiredFiles.some((file) => typeof file !== 'string' || !file))) throw new Error('router backend: requiredFiles must be non-empty paths')
    const timeout = cfg.timeoutMs ?? 5000
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) throw new Error('router backend: timeoutMs must be an integer from 1 to 2147483647 milliseconds')
    if (cfg.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(cfg.expectedSha256)) throw new Error('router backend: expectedSha256 must be a 64-character SHA-256')
  }

  async available(signal?: AbortSignal): Promise<{ ok: boolean; why?: string }> {
    if (signal?.aborted) throw signal.reason ?? new Error('aborted')
    if (this.verified) return this.verified
    const missing = (this.cfg.requiredFiles ?? []).filter((file) => !existsSync(file))
    if (missing.length) return (this.verified = { ok: false, why: `not installed (missing ${missing[0]})` })
    if (this.cfg.expectedSha256 && this.cfg.requiredFiles?.[0]) {
      try {
        const got = await sha256File(this.cfg.requiredFiles[0], signal)
        if (got !== this.cfg.expectedSha256.toLowerCase()) return (this.verified = { ok: false, why: 'weights do not match the pinned sha256' })
      } catch (error: any) {
        if (signal?.aborted) throw error
        return (this.verified = { ok: false, why: `cannot read weights: ${String(error?.message ?? error).slice(0, 80)}` })
      }
    }
    return (this.verified = { ok: true })
  }

  decide(cls: DecisionClass, req: { task: string; candidates: Candidate[]; signal?: AbortSignal }): Promise<string | null> {
    return new Promise((resolve, reject) => {
      if (req.signal?.aborted) { reject(req.signal.reason ?? new Error('aborted')); return }
      const child = spawn(this.cfg.command, this.cfg.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
        env: { PATH: process.env['PATH'] ?? '', SystemRoot: process.env['SystemRoot'] ?? '', NEEDLE_TELEMETRY: '0' },
      })
      let output = ''
      let done = false
      const killTree = () => {
        if (child.pid !== undefined && process.platform !== 'win32') {
          try { process.kill(-child.pid, 'SIGKILL'); return } catch {}
        }
        if (child.pid !== undefined && process.platform === 'win32') {
          // Windows has no negative-pid process groups; taskkill /T is the tree equivalent.
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {})
        }
        child.kill('SIGKILL')
      }
      const finish = (fn: () => void) => {
        if (done) return
        done = true
        clearTimeout(timer)
        req.signal?.removeEventListener('abort', abort)
        fn()
      }
      const abort = () => { killTree(); finish(() => reject(req.signal?.reason ?? new Error('aborted'))) }
      const timer = setTimeout(() => { killTree(); finish(() => reject(new Error('router backend timed out'))) }, this.cfg.timeoutMs ?? 5000)
      req.signal?.addEventListener('abort', abort, { once: true })
      if (req.signal?.aborted) abort()
      child.stdout.on('data', (data) => {
        output += data
        if (output.length > 4096) { killTree(); finish(() => reject(new Error('router backend output too large'))) }
      })
      child.stderr.on('data', () => {}) // drain stderr so a noisy child cannot block on a full pipe
      child.once('error', (error) => finish(() => reject(error)))
      child.once('close', (code) => {
        if (process.platform !== 'win32' && child.pid !== undefined) {
          try { process.kill(-child.pid, 'SIGKILL') } catch {}
        }
        finish(() => {
          if (code !== 0) { reject(new Error(`router backend exited with code ${code}`)); return }
          try {
            const trimmed = output.trim()
            if (!trimmed || trimmed.includes('\n')) throw new Error('expected exactly one JSON line')
            const parsed = JSON.parse(trimmed)
            resolve(typeof parsed?.choice === 'string' ? parsed.choice : null)
          } catch {
            reject(new Error('router backend returned invalid JSON'))
          }
        })
      })
      child.stdin.on('error', () => {})
      child.stdin.end(JSON.stringify({
        class: cls,
        task: req.task,
        candidates: req.candidates.map(({ id, description }) => ({ id, description })),
      }) + '\n')
    })
  }
}
