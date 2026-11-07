import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import { withFileLock } from '../../util/filelock.js'
import { LLMError } from './types.js'

export interface RateLimiterConfig {
  /** Requests allowed in any 60s window. Default 16, which leaves headroom under a 20/min provider cap. */
  perMinute?: number
  /** Daily request ceiling. Undefined means no local ceiling. */
  perDay?: number
  /** Requests in flight at once. Default 1; every sub-agent shares this limiter (D-023). */
  maxConcurrent?: number
  /** Persist the daily counter here so a restart does not reset it. Omit for in-memory only. */
  statePath?: string
  /** Provider name used in error messages. */
  provider?: string
  /** Injectable for tests. */
  now?: () => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

function validDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

interface DayState {
  day: string
  count: number
}

const MINUTE = 60_000

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(signal!.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Shared request limiter for one provider account.
 *
 * - Sliding 60s window (`perMinute`) and an optional daily ceiling (`perDay`).
 * - Every attempt counts toward the daily total, including ones that fail:
 *   some providers bill failed calls against the quota, so blind retries would
 *   burn it. Counting attempts is the conservative choice.
 * - The day boundary is UTC. That is an assumption; providers may reset elsewhere.
 * - `maxConcurrent` bounds in-flight requests so a sub-agent pool cannot multiply them.
 */
export class RateLimiter {
  private readonly perMinute: number
  private readonly perDay?: number
  private readonly maxConcurrent: number
  private readonly statePath?: string
  private readonly provider: string
  private readonly now: () => number
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  private stamps: number[] = []
  private inFlight = 0
  private waiters: Array<() => void> = []
  private state: DayState

  constructor(config: RateLimiterConfig = {}) {
    this.perMinute = config.perMinute ?? 16
    if (config.perDay !== undefined) this.perDay = config.perDay
    this.maxConcurrent = config.maxConcurrent ?? 1
    if (config.statePath !== undefined) this.statePath = config.statePath
    this.provider = config.provider ?? 'provider'
    this.now = config.now ?? Date.now
    this.sleep = config.sleep ?? defaultSleep
    if (!Number.isSafeInteger(this.perMinute) || this.perMinute < 1) throw new LLMError('config', 'rate limiter: perMinute must be a positive safe integer', this.provider)
    if (!Number.isSafeInteger(this.maxConcurrent) || this.maxConcurrent < 1) throw new LLMError('config', 'rate limiter: maxConcurrent must be a positive safe integer', this.provider)
    if (this.perDay !== undefined && (!Number.isSafeInteger(this.perDay) || this.perDay < 1)) throw new LLMError('config', 'rate limiter: perDay must be a positive safe integer', this.provider)
    this.state = this.load()
  }

  /** Requests left today, or undefined when there is no local ceiling. */
  remainingToday(): number | undefined {
    if (this.perDay === undefined) return undefined
    this.rollDay()
    return Math.max(0, this.perDay - this.state.count)
  }

  /** Waits for a slot and for the rate window, counts the attempt, then runs `fn`. */
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.checkDaily()
    await this.takeSlot(signal)
    try {
      this.checkDaily()
      await this.waitForWindow(signal)
      await this.bumpDaily()
      return await fn()
    } finally {
      this.releaseSlot()
    }
  }

  private checkDaily() {
    if (this.perDay === undefined) return
    this.rollDay()
    if (this.state.count >= this.perDay) {
      throw new LLMError(
        'quota',
        `${this.provider}: daily request ceiling reached (${this.state.count}/${this.perDay}). ` +
          `The local counter assumes a UTC day boundary; check the provider for its real reset time.`,
        this.provider,
      )
    }
  }

  private async takeSlot(signal?: AbortSignal) {
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight++
      return
    }
    await new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      const onAbort = () => {
        const i = this.waiters.indexOf(grant)
        if (i >= 0) this.waiters.splice(i, 1)
        reject(signal!.reason)
      }
      if (signal?.aborted) return reject(signal.reason)
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiters.push(grant)
    })
    // The releasing request handed its slot straight to us; inFlight is unchanged.
  }

  private releaseSlot() {
    const next = this.waiters.shift()
    if (next) next()
    else this.inFlight--
  }

  private async waitForWindow(signal?: AbortSignal) {
    for (;;) {
      signal?.throwIfAborted()
      const t = this.now()
      while (this.stamps.length && t - this.stamps[0]! >= MINUTE) this.stamps.shift()
      if (this.stamps.length < this.perMinute) {
        this.stamps.push(t)
        return
      }
      await this.sleep(this.stamps[0]! + MINUTE - t + 1, signal)
    }
  }

  private dayKey(): string {
    return new Date(this.now()).toISOString().slice(0, 10)
  }

  private rollDay() {
    const day = this.dayKey()
    if (this.state.day !== day) this.state = { day, count: 0 }
  }

  private async bumpDaily(): Promise<void> {
    const day = this.dayKey()
    if (!this.statePath) {
      if (this.perDay !== undefined && this.state.count >= this.perDay) {
        throw new LLMError('quota', `${this.provider}: daily request ceiling reached (${this.state.count}/${this.perDay}).`, this.provider)
      }
      this.state = { day, count: this.state.day === day ? this.state.count + 1 : 1 }
      return
    }

    // The persistent ceiling is shared across processes. Read, check, increment and
    // replace the state while holding one lock so concurrent Harness processes cannot
    // each spend the same final request slot.
    await withFileLock(`${this.statePath}.lock`, async () => {
      const current = await this.readStateFile(day)
      if (this.perDay !== undefined && current.count >= this.perDay) {
        throw new LLMError(
          'quota',
          `${this.provider}: daily request ceiling reached (${current.count}/${this.perDay}). The local counter assumes a UTC day boundary; check the provider for its real reset time.`,
          this.provider,
        )
      }
      const next = { day, count: current.count + 1 }
      await mkdir(dirname(this.statePath!), { recursive: true })
      const tmp = `${this.statePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
      try {
        await writeFile(tmp, JSON.stringify(next), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        await rename(tmp, this.statePath!)
      } catch (err) {
        await unlink(tmp).catch(() => {})
        throw new LLMError('config', `${this.provider}: could not persist the daily request counter; refusing to send the request (${err instanceof Error ? err.message : String(err)})`, this.provider)
      }
      this.state = next
    })
  }

  private async readStateFile(today: string): Promise<DayState> {
    let rawText: string
    try {
      rawText = await readFile(this.statePath!, 'utf8')
    } catch (err: any) {
      if (err?.code === 'ENOENT') return { day: today, count: 0 }
      throw new LLMError('config', `${this.provider}: could not read the daily request counter; refusing to send the request (${err?.message ?? String(err)})`, this.provider)
    }
    let raw: any
    try {
      raw = JSON.parse(rawText)
    } catch {
      throw new LLMError('config', `${this.provider}: daily request counter is corrupt; refusing to reset it automatically`, this.provider)
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
        typeof raw.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.day) ||
        !Number.isSafeInteger(raw.count) || raw.count < 0) {
      throw new LLMError('config', `${this.provider}: daily request counter has an invalid shape; refusing to reset it automatically`, this.provider)
    }
    if (raw.day > today) {
      throw new LLMError('config', `${this.provider}: daily request counter date is ahead of the system date; refusing to reset it automatically`, this.provider)
    }
    return raw.day === today ? { day: today, count: raw.count } : { day: today, count: 0 }
  }

  private load(): DayState {
    const fresh = { day: this.dayKey(), count: 0 }
    if (!this.statePath) return fresh
    try {
      const raw = JSON.parse(readFileSync(this.statePath, 'utf8'))
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
          typeof raw.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.day) ||
          !Number.isSafeInteger(raw.count) || raw.count < 0) {
        throw new Error('invalid counter shape')
      }
      if (raw.day > fresh.day) throw new Error('counter date is ahead of the system date')
      return raw.day === fresh.day ? { day: raw.day, count: raw.count } : fresh
    } catch (e: any) {
      if (e?.code === 'ENOENT') return fresh
      throw new LLMError('config', `${this.provider}: could not load daily request counter: ${e?.message ?? String(e)}`, this.provider)
    }
  }
}
