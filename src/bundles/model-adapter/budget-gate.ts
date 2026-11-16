import { randomUUID } from 'node:crypto'
import {
  BudgetExceededError,
  BudgetReservationStoreError,
  Budgets,
  SQLiteBudgetReservationStore,
  type BudgetMetric,
  type BudgetScope,
  type BudgetStatus,
  type Reservation,
  type SpendResult,
} from '../app-core/budgets.js'
import type { BudgetReservation } from '../../architecture/contracts.js'
import type { CompletionRequest } from './types.js'

/** Output tokens assumed for a call that sets no `maxTokens`: the reservation must cover the worst case, not the average. */
export const DEFAULT_OUTPUT_TOKEN_RESERVE = 1024
/** Characters per token used to size a prompt. 3 is deliberately pessimistic (English text is ~4; code and JSON run lower). */
const CHARS_PER_TOKEN = 3

export interface SharedBudgetGateConfig {
  /** Stable project identity used to partition the shared database. */
  projectId: string
  /** Expiry must exceed the maximum expected provider-call duration. Default: 30 minutes. */
  reservationTtlMs?: number
}

interface SharedHold {
  reservation: BudgetReservation
  metric: BudgetMetric
  settlementKey: string
}

function usageAmount(metric: BudgetMetric, estimate: number, usage: { inputTokens: number; outputTokens: number } | undefined): number {
  if (metric === 'requests') return 1
  const used = usage ? usage.inputTokens + usage.outputTokens : estimate
  return Number.isFinite(used) && used >= 0 ? used : estimate
}

/** A cheap upper-ish estimate of the tokens a request will cost: the prompt as sent, plus the output it is allowed to produce. */
export function estimateRequestTokens(req: Pick<CompletionRequest, 'messages' | 'system' | 'tools' | 'maxTokens'>, defaultOutput = DEFAULT_OUTPUT_TOKEN_RESERVE): number {
  if (!Number.isSafeInteger(defaultOutput) || defaultOutput <= 0) throw new RangeError('budget gate: default output reserve must be a positive safe integer')
  if (req.maxTokens !== undefined && (!Number.isSafeInteger(req.maxTokens) || req.maxTokens <= 0)) {
    throw new RangeError('budget gate: maxTokens must be a positive safe integer when supplied')
  }
  const prompt = JSON.stringify({ system: req.system, messages: req.messages, tools: req.tools }) ?? ''
  return Math.ceil(prompt.length / CHARS_PER_TOKEN) + (req.maxTokens ?? defaultOutput)
}

/** One in-flight call's hold on the budget. Exactly one of settle / fail / release takes effect. */
export class CallReservation {
  private finished = false
  private shared?: { store: SQLiteBudgetReservationStore; holds: SharedHold[] }

  constructor(
    private readonly budgets: Budgets,
    private readonly requests: Reservation,
    private readonly tokens: Reservation,
  ) {}

  attachShared(store: SQLiteBudgetReservationStore, holds: SharedHold[]): this {
    if (this.finished || this.shared) throw new Error('budget gate: shared reservations can only be attached once before completion')
    this.shared = { store, holds }
    return this
  }

  private settleLocal(usage: { inputTokens: number; outputTokens: number } | undefined): SpendResult[] {
    if (this.finished) return []
    this.finished = true
    const used = usage ? usage.inputTokens + usage.outputTokens : this.tokens.amount
    const out = [this.budgets.record('requests', 1), this.budgets.record('tokens', Number.isFinite(used) && used >= 0 ? used : this.tokens.amount)]
    this.budgets.release(this.requests)
    this.budgets.release(this.tokens)
    return out
  }

  private releaseLocal(): void {
    if (this.finished) return
    this.finished = true
    this.budgets.release(this.requests)
    this.budgets.release(this.tokens)
  }

  private failLocal(): SpendResult[] {
    if (this.finished) return []
    this.finished = true
    const out = [this.budgets.record('requests', 1)]
    this.budgets.release(this.requests)
    this.budgets.release(this.tokens)
    return out
  }

  /** Synchronous local-only settlement. Shared reservations must use settleAsync(). */
  settle(usage: { inputTokens: number; outputTokens: number } | undefined): SpendResult[] {
    if (this.shared) throw new BudgetReservationStoreError('budget gate: shared reservation requires settleAsync()')
    return this.settleLocal(usage)
  }

  /** Settle every shared scope before returning the local spend report. */
  async settleAsync(usage: { inputTokens: number; outputTokens: number } | undefined): Promise<SpendResult[]> {
    if (this.finished) return []
    let failure: unknown
    if (this.shared) {
      const results = await Promise.allSettled(this.shared.holds.map((hold) => this.shared!.store.settle({
        reservationId: hold.reservation.reservationId,
        actualAmount: usageAmount(hold.metric, hold.reservation.reservedAmount, usage),
        idempotencyKey: hold.settlementKey,
      })))
      failure = results.find((result) => result.status === 'rejected')
      if (failure && failure.status === 'rejected') failure = failure.reason
    }
    const spent = this.settleLocal(usage)
    if (failure !== undefined) throw failure
    return spent
  }

  /** Synchronous local-only release. Shared reservations must use releaseAsync(). */
  release(): void {
    if (this.shared) throw new BudgetReservationStoreError('budget gate: shared reservation requires releaseAsync()')
    this.releaseLocal()
  }

  async releaseAsync(): Promise<void> {
    if (this.finished) return
    let failure: unknown
    if (this.shared) {
      const results = await Promise.allSettled(this.shared.holds.map((hold) =>
        this.shared!.store.release(hold.reservation.reservationId, 'provider.not_dispatched'),
      ))
      const rejected = results.find((result) => result.status === 'rejected')
      if (rejected?.status === 'rejected') failure = rejected.reason
    }
    this.releaseLocal()
    if (failure !== undefined) throw failure
  }

  /** Synchronous local-only failure accounting. Shared reservations must use failAsync(). */
  fail(): SpendResult[] {
    if (this.shared) throw new BudgetReservationStoreError('budget gate: shared reservation requires failAsync()')
    return this.failLocal()
  }

  /**
   * Failed provider attempts count as requests but not tokens. A shared request
   * reservation is settled; token reservations are released.
   */
  async failAsync(): Promise<SpendResult[]> {
    if (this.finished) return []
    let failure: unknown
    if (this.shared) {
      const results = await Promise.allSettled(this.shared.holds.map((hold) => hold.metric === 'requests'
        ? this.shared!.store.settle({
            reservationId: hold.reservation.reservationId,
            actualAmount: 1,
            idempotencyKey: hold.settlementKey,
          })
        : this.shared!.store.release(hold.reservation.reservationId, 'provider.failed'),
      ))
      const rejected = results.find((result) => result.status === 'rejected')
      if (rejected?.status === 'rejected') failure = rejected.reason
    }
    const spent = this.failLocal()
    if (failure !== undefined) throw failure
    return spent
  }
}

/**
 * ARCH-03: the budget as the model-call boundary sees it. Every agent and sub-agent reaches a model through
 * `ctx.llm.complete`, so a gate there is shared by all of them automatically and cannot be bypassed by a bundle that
 * forgot to call it.
 */
export class BudgetGate {
  private readonly reservationTtlMs: number

  constructor(
    readonly budgets: Budgets,
    readonly defaultOutputTokens = DEFAULT_OUTPUT_TOKEN_RESERVE,
    private readonly sharedStore?: SQLiteBudgetReservationStore,
    private readonly sharedConfig?: SharedBudgetGateConfig,
  ) {
    this.reservationTtlMs = sharedConfig?.reservationTtlMs ?? 30 * 60 * 1000
    if (sharedStore && (!sharedConfig?.projectId?.trim() || !Number.isSafeInteger(this.reservationTtlMs) || this.reservationTtlMs < 1_000)) {
      throw new RangeError('budget gate: shared store requires a project id and reservation TTL of at least 1000 ms')
    }
  }

  private reserveLocal(req: Pick<CompletionRequest, 'messages' | 'system' | 'tools' | 'maxTokens'>): CallReservation {
    const requests = this.budgets.reserve('requests', 1)
    try {
      const tokens = this.budgets.reserve('tokens', estimateRequestTokens(req, this.defaultOutputTokens))
      return new CallReservation(this.budgets, requests, tokens)
    } catch (error) {
      this.budgets.release(requests)
      throw error
    }
  }

  /** Synchronous reservation remains available only when no shared store is configured. */
  reserve(req: Pick<CompletionRequest, 'messages' | 'system' | 'tools' | 'maxTokens'>): CallReservation {
    if (this.sharedStore) throw new BudgetReservationStoreError('budget gate: shared reservations require reserveAsync()')
    return this.reserveLocal(req)
  }

  /**
   * Hold local task/session/day capacity and cross-process session/day capacity
   * before any request is logged or dispatched.
   */
  async reserveAsync(
    req: Pick<CompletionRequest, 'messages' | 'system' | 'tools' | 'maxTokens'>,
    sessionId?: string,
  ): Promise<CallReservation> {
    const local = this.reserveLocal(req)
    if (!this.sharedStore || !this.sharedConfig) return local

    const callId = randomUUID()
    const expiresAt = new Date(this.budgets.currentTimestamp() + this.reservationTtlMs).toISOString()
    const targets: Array<{ scope: BudgetScope; subjectId: string }> = [
      ...(sessionId ? [{ scope: 'session' as const, subjectId: `session:${sessionId}` }] : []),
      { scope: 'day', subjectId: `day:${this.budgets.currentDay()}` },
    ]
    const metrics: Array<{ metric: BudgetMetric; amount: number }> = [
      { metric: 'requests', amount: 1 },
      { metric: 'tokens', amount: estimateRequestTokens(req, this.defaultOutputTokens) },
    ]
    const holds: SharedHold[] = []
    try {
      for (const metric of metrics) {
        for (const target of targets) {
          const hardLimit = this.budgets.hardLimit(metric.metric, target.scope)
          if (hardLimit === undefined) continue
          const idempotencyKey = `call:${callId}:${target.scope}:${metric.metric}`
          const decision = await this.sharedStore.reserve({
            projectId: this.sharedConfig.projectId,
            subjectId: target.subjectId,
            metric: metric.metric,
            amount: metric.amount,
            hardLimit,
            idempotencyKey,
            expiresAt,
          })
          if (!decision.accepted) {
            if (decision.reason === 'limit-exceeded') {
              const usage = await this.sharedStore.usage(this.sharedConfig.projectId, target.subjectId, metric.metric)
              const status = this.budgets.status()
              status[metric.metric][target.scope].used = usage.committed + usage.reserved
              status[metric.metric][target.scope].hardBreached = true
              throw new BudgetExceededError(metric.metric, target.scope, status)
            }
            throw new BudgetReservationStoreError('budget gate: shared reservation idempotency conflict')
          }
          holds.push({
            reservation: decision.reservation,
            metric: metric.metric,
            settlementKey: `settle:${callId}:${target.scope}:${metric.metric}`,
          })
        }
      }
      return holds.length ? local.attachShared(this.sharedStore, holds) : local
    } catch (error) {
      await Promise.allSettled(holds.map((hold) => this.sharedStore!.release(hold.reservation.reservationId, 'budget.reserve_failed')))
      local.release()
      throw error
    }
  }

  status(): BudgetStatus {
    return this.budgets.status()
  }

  /** Status with cross-process session/day usage refreshed from SQLite. */
  async statusAsync(sessionId?: string): Promise<BudgetStatus> {
    const status = this.budgets.status()
    if (!this.sharedStore || !this.sharedConfig) return status
    const targets: Array<{ scope: BudgetScope; subjectId: string }> = [
      ...(sessionId ? [{ scope: 'session' as const, subjectId: `session:${sessionId}` }] : []),
      { scope: 'day', subjectId: `day:${this.budgets.currentDay()}` },
    ]
    for (const metric of ['requests', 'tokens'] as const) {
      for (const target of targets) {
        const hard = this.budgets.hardLimit(metric, target.scope)
        const soft = status[metric][target.scope].soft
        if (hard === undefined && soft === undefined) continue
        const usage = await this.sharedStore.usage(this.sharedConfig.projectId, target.subjectId, metric)
        const used = usage.committed + usage.reserved
        status[metric][target.scope] = {
          ...status[metric][target.scope],
          used,
          softBreached: soft !== undefined && used >= soft,
          hardBreached: hard !== undefined && used >= hard,
        }
      }
    }
    return status
  }

  /** Start a new task's allowance. Not called automatically: a "task" is whatever the caller (CLI, desktop, a script) says it is. */
  resetTask(): void {
    this.budgets.resetTask()
  }
}

export { BudgetExceededError }
