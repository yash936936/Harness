import { BudgetExceededError, Budgets, type BudgetStatus, type Reservation, type SpendResult } from '../app-core/budgets.js'
import type { CompletionRequest } from './types.js'

/** Output tokens assumed for a call that sets no `maxTokens`: the reservation must cover the worst case, not the average. */
export const DEFAULT_OUTPUT_TOKEN_RESERVE = 1024
/** Characters per token used to size a prompt. 3 is deliberately pessimistic (English text is ~4; code and JSON run lower). */
const CHARS_PER_TOKEN = 3

/** A cheap upper-ish estimate of the tokens a request will cost: the prompt as sent, plus the output it is allowed to produce. */
export function estimateRequestTokens(req: Pick<CompletionRequest, 'messages' | 'system' | 'tools' | 'maxTokens'>, defaultOutput = DEFAULT_OUTPUT_TOKEN_RESERVE): number {
  const prompt = JSON.stringify({ system: req.system, messages: req.messages, tools: req.tools }) ?? ''
  return Math.ceil(prompt.length / CHARS_PER_TOKEN) + (req.maxTokens ?? defaultOutput)
}

/** One in-flight call's hold on the budget. Exactly one of `settle` / `fail` takes effect; later calls are no-ops. */
export class CallReservation {
  private finished = false
  constructor(
    private readonly budgets: Budgets,
    private readonly requests: Reservation,
    private readonly tokens: Reservation,
  ) {}

  /** The call returned. Books the request and the tokens it really used (the estimate if the provider reported none). */
  settle(usage: { inputTokens: number; outputTokens: number } | undefined): SpendResult[] {
    if (this.finished) return []
    this.finished = true
    const used = usage ? usage.inputTokens + usage.outputTokens : this.tokens.amount
    const out = [this.budgets.record('requests', 1), this.budgets.record('tokens', Number.isFinite(used) && used >= 0 ? used : this.tokens.amount)]
    this.budgets.release(this.requests)
    this.budgets.release(this.tokens)
    return out
  }

  /**
   * The call failed. The attempt still counts as a request (a metered provider bills attempts too, D-044); tokens are not
   * charged because the provider reported none. A provider that bills a failed call's tokens is under-counted here.
   */
  fail(): SpendResult[] {
    if (this.finished) return []
    this.finished = true
    const out = [this.budgets.record('requests', 1)]
    this.budgets.release(this.requests)
    this.budgets.release(this.tokens)
    return out
  }
}

/**
 * ARCH-03: the budget as the model-call boundary sees it. Every agent and sub-agent reaches a model through
 * `ctx.llm.complete`, so a gate there is shared by all of them automatically and cannot be bypassed by a bundle that
 * forgot to call it.
 */
export class BudgetGate {
  constructor(readonly budgets: Budgets, private readonly defaultOutput = DEFAULT_OUTPUT_TOKEN_RESERVE) {}

  /** Hold capacity for one call or throw `BudgetExceededError` (holding nothing). */
  reserve(req: Pick<CompletionRequest, 'messages' | 'system' | 'tools' | 'maxTokens'>): CallReservation {
    const requests = this.budgets.reserve('requests', 1)
    try {
      const tokens = this.budgets.reserve('tokens', estimateRequestTokens(req, this.defaultOutput))
      return new CallReservation(this.budgets, requests, tokens)
    } catch (e) {
      this.budgets.release(requests)
      throw e
    }
  }

  status(): BudgetStatus {
    return this.budgets.status()
  }

  /** Start a new task's allowance. Not called automatically: a "task" is whatever the caller (CLI, desktop, a script) says it is. */
  resetTask(): void {
    this.budgets.resetTask()
  }
}

export { BudgetExceededError }
