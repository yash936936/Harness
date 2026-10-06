import { Context, Service } from 'cordis'
import '../session-log/index.js'
import '../tool-registry/index.js'
import { ToolDeniedError, type ToolCallEvent } from '../tool-registry/index.js'
import { BUILTIN_DENY_RULES, collectStrings } from './denylist.js'
import { BUILTIN_SIGNALS } from './signals.js'
import { PolicyError, type ApprovalDecision, type ApprovalRequest, type Decision, type DenyRule, type PolicyConfig, type Signal, type SignalResult } from './types.js'

export * from './types.js'
export { BUILTIN_DENY_RULES, collectStrings, normalizeForMatch, normalizePath } from './denylist.js'
export { BUILTIN_SIGNALS, pathCriticality, diffSize, pathsOf, contentLength } from './signals.js'

declare module 'cordis' {
  interface Context {
    policy: PolicyGates
  }
}

/** The input field a real-fs-write call may carry to report the model's own confidence (0..1). Declare it in the tool's schema. */
export const CONFIDENCE_FIELD = 'confidence'
export const confidenceProperty = { type: 'number', minimum: 0, maximum: 1, description: 'Your confidence (0 to 1) that this write is correct and safe.' } as const

interface Pending {
  req: ApprovalRequest
  settle(d: ApprovalDecision, outcome: 'approved' | 'denied' | 'timeout'): void
}

/**
 * `ctx.policy` — Phase 5.3-5.5. A `tools/pre-execute` hook that applies the policy table to every tool call:
 *   deny-listed (any class)         -> blocked, no override
 *   external-side-effect            -> ALWAYS held for approval, whatever any score says
 *   real-fs-write                   -> allowed if combined confidence >= threshold, else held
 *   sandbox-write                   -> allowed, decision logged
 *   read-only                       -> allowed, no approval step (decision still logged)
 * Combined confidence = MIN(model's self-report, every independent signal). The self-report alone can never allow
 * a write: with no independent signal available, or no valid self-report, the write is held (D-078).
 * Every decision is a `policy.decision` event; holds add `approval.pending` and `approval.resolved`. A decision that cannot
 * be logged fails closed (the registry treats a throwing hook as a denial). Load this AFTER `subagent-scope`, so a call the
 * scope would refuse is refused before anyone is asked to approve it.
 */
export class PolicyGates extends Service {
  static inject = ['log', 'tools']

  private readonly root: string
  private readonly threshold: number
  private readonly timeoutMs: number
  private readonly signals: Signal[]
  private readonly rules: DenyRule[]
  private readonly pendingMap = new Map<string, Pending>()
  private seq = 0

  constructor(ctx: Context, private readonly config: PolicyConfig = {}) {
    super(ctx, 'policy')
    this.root = config.projectRoot ?? process.cwd()
    this.threshold = config.confidenceThreshold ?? 0.8
    if (!(this.threshold >= 0 && this.threshold <= 1)) throw new PolicyError('policy: confidenceThreshold must be between 0 and 1')
    this.timeoutMs = config.approvalTimeoutMs ?? 120_000
    if (!(this.timeoutMs > 0)) throw new PolicyError('policy: approvalTimeoutMs must be positive')
    this.signals = [...BUILTIN_SIGNALS, ...(config.signals ?? [])]
    this.rules = [...BUILTIN_DENY_RULES, ...(config.extraDenyRules ?? [])]
    ctx.on('tools/pre-execute', (ev: ToolCallEvent) => this.gate(ev))
  }

  /** The decision for a call. Pure and synchronous: no logging, no waiting. */
  evaluate(ev: ToolCallEvent): Decision {
    const cls = ev.tool.actionClass
    const strings = collectStrings(ev.input)
    // A command can be split across fields ({ command: 'rm', args: ['-rf', '/'] }): also match the strings joined together.
    if (strings.length > 1) strings.push(strings.join(' '))
    for (const rule of this.rules) {
      const hit = rule.matches(strings)
      if (hit) return { verdict: 'deny', class: cls, rule: rule.id, reason: `deny-listed (${rule.id}): matched ${hit}. This cannot be overridden.` }
    }
    switch (cls) {
      case 'read-only':
        return { verdict: 'allow', class: cls, reason: 'read-only: no approval step' }
      case 'sandbox-write':
        return { verdict: 'allow-logged', class: cls, reason: 'sandbox-scoped write: autonomous, logged' }
      case 'external-side-effect':
        return { verdict: 'hold', class: cls, reason: 'external side effect: always requires approval, whatever any confidence score says' }
      case 'real-fs-write':
        return this.scoreWrite(ev)
    }
  }

  private scoreWrite(ev: ToolCallEvent): Decision {
    const cls = ev.tool.actionClass
    const raw = (ev.input as Record<string, unknown> | null)?.[CONFIDENCE_FIELD]
    const self = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : null
    const signals: SignalResult[] = []
    for (const s of this.signals) {
      const r = s(ev, { projectRoot: this.root })
      if (r) signals.push(r)
    }
    const base = { class: cls, self, signals } as const
    if (!signals.length) return { ...base, verdict: 'hold', reason: 'real-fs-write held: no independent signal is available for this call, and a self-reported confidence is never enough on its own' }
    if (self === null) return { ...base, verdict: 'hold', reason: 'real-fs-write held: no valid self-reported confidence (a number from 0 to 1) in the call' }
    const score = Math.min(self, ...signals.map((s) => s.score))
    const weakest = signals.reduce((a, b) => (b.score < a.score ? b : a))
    if (score >= this.threshold) return { ...base, verdict: 'allow-logged', score, reason: `real-fs-write auto-approved: combined score ${score} >= ${this.threshold}` }
    const why = score === self ? `the model's own confidence (${self})` : `${weakest.name} (${weakest.score}${weakest.note ? `: ${weakest.note}` : ''})`
    return { ...base, verdict: 'hold', score, reason: `real-fs-write held: combined score ${score} < ${this.threshold}, limited by ${why}` }
  }

  private async gate(ev: ToolCallEvent): Promise<void> {
    const d = this.evaluate(ev)
    const sid = ev.sessionId
    await this.ctx.log.append(sid, 'policy.decision', { tool: ev.tool.name, ...d }, ev.actor)
    if (d.verdict === 'deny') throw new ToolDeniedError(d.reason)
    if (d.verdict !== 'hold') return

    const req: ApprovalRequest = {
      id: `ap-${Date.now().toString(36)}-${++this.seq}`,
      sessionId: sid,
      ...(ev.actor ? { actor: ev.actor } : {}),
      tool: ev.tool.name,
      class: d.class,
      reason: d.reason,
      input: ev.input,
      ...(d.score !== undefined ? { score: d.score } : {}),
      requestedAt: new Date().toISOString(),
    }
    const answer = new Promise<{ d: ApprovalDecision; outcome: 'approved' | 'denied' | 'timeout' }>((resolveAnswer) => {
      let done = false
      const timer = setTimeout(() => finish({ approve: false, note: `no answer within ${this.timeoutMs} ms` }, 'timeout'), this.timeoutMs)
      timer.unref?.()
      const finish = (dec: ApprovalDecision, outcome: 'approved' | 'denied' | 'timeout') => {
        if (done) return
        done = true
        clearTimeout(timer)
        this.pendingMap.delete(req.id)
        resolveAnswer({ d: dec, outcome })
      }
      this.pendingMap.set(req.id, { req, settle: finish })
    })
    // Pending is registered before it is logged or offered, so an approver or a UI can answer immediately.
    try {
      await this.ctx.log.append(sid, 'approval.pending', { ...req }, ev.actor)
    } catch (e) {
      this.pendingMap.get(req.id)?.settle({ approve: false, note: 'could not log the request' }, 'denied')
      throw e
    }
    if (this.config.approver) {
      void Promise.resolve()
        .then(() => this.config.approver!(req))
        .then(
          (dec) => this.settleExternal(req.id, dec && typeof dec.approve === 'boolean' ? dec : { approve: false, note: 'approver gave no valid answer' }),
          (err) => this.settleExternal(req.id, { approve: false, note: `approver failed: ${err?.message ?? err}` }),
        )
    }
    const { d: dec, outcome } = await answer
    await this.ctx.log.append(sid, 'approval.resolved', { id: req.id, tool: ev.tool.name, outcome, ...(dec.by ? { by: dec.by } : {}), ...(dec.note ? { note: dec.note } : {}) }, ev.actor)
    if (outcome !== 'approved') throw new ToolDeniedError(`approval ${outcome === 'timeout' ? 'timed out' : 'denied'}${dec.note ? `: ${dec.note}` : ''}`)
  }

  private settleExternal(id: string, dec: ApprovalDecision): void {
    this.pendingMap.get(id)?.settle(dec, dec.approve ? 'approved' : 'denied')
  }

  /** Holds waiting for an answer. */
  pending(): ApprovalRequest[] {
    return [...this.pendingMap.values()].map((p) => p.req)
  }

  /** Answer a hold. Throws if there is no such pending hold (already answered, timed out, or unknown). */
  resolve(id: string, decision: ApprovalDecision): void {
    const p = this.pendingMap.get(id)
    if (!p) throw new PolicyError(`policy: no pending approval "${id}"`)
    p.settle(decision, decision.approve ? 'approved' : 'denied')
  }
}

export const name = 'bundle-policy-gates'
export function apply(ctx: Context, config: PolicyConfig = {}) {
  ctx.plugin(PolicyGates, config)
}
