import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
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
  /** Set if the counter could not be written to disk. The in-memory count still applies. */
  lastPersistError?: string

  constructor(config: RateLimiterConfig = {}) {
    this.perMinute = config.perMinute ?? 16
    if (config.perDay !== undefined) this.perDay = config.perDay
    this.maxConcurrent = config.maxConcurrent ?? 1
    if (config.statePath !== undefined) this.statePath = config.statePath
    this.provider = config.provider ?? 'provider'
    this.now = config.now ?? Date.now
    this.sleep = config.sleep ?? defaultSleep
    if (!(this.perMinute >= 1)) throw new LLMError('config', 'rate limiter: perMinute must be at least 1', this.provider)
    if (!(this.maxConcurrent >= 1)) throw new LLMError('config', 'rate limiter: maxConcurrent must be at least 1', this.provider)
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
      this.bumpDaily()
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

  private bumpDaily() {
    this.rollDay()
    this.state.count++
    this.save()
  }

  private load(): DayState {
    const fresh = { day: this.dayKey(), count: 0 }
    if (!this.statePath) return fresh
    try {
      const raw = JSON.parse(readFileSync(this.statePath, 'utf8'))
      if (raw && raw.day === fresh.day && Number.isInteger(raw.count) && raw.count >= 0) return { day: raw.day, count: raw.count }
    } catch {
      // No file yet, or unreadable: start from zero.
    }
    return fresh
  }

  private save() {
    if (!this.statePath) return
    try {
      mkdirSync(dirname(this.statePath), { recursive: true })
      const tmp = `${this.statePath}.tmp`
      writeFileSync(tmp, JSON.stringify(this.state))
      renameSync(tmp, this.statePath)
    } catch (e: any) {
      this.lastPersistError = e?.message ?? String(e)
    }
  }
}
