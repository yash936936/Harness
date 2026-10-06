import type { ActionClass, ToolCallEvent } from '../tool-registry/index.js'

/** `allow`: runs, no step. `allow-logged`: runs; the decision is logged with its reasons. `hold`: waits for an approval. `deny`: blocked, no override. */
export type Verdict = 'allow' | 'allow-logged' | 'hold' | 'deny'

export interface SignalResult {
  name: string
  /** 0 (risky) .. 1 (safe). */
  score: number
  note?: string
}

/** An INDEPENDENT risk signal: computed from the call itself, never from what the model says about it. Return undefined when not applicable. */
export type Signal = (ev: ToolCallEvent, env: { projectRoot: string }) => SignalResult | undefined

export interface Decision {
  verdict: Verdict
  class: ActionClass
  reason: string
  /** Combined confidence (real-fs-write only): the MINIMUM of the self-report and every independent signal. */
  score?: number
  /** The model's own report, if it gave a valid one. */
  self?: number | null
  signals?: SignalResult[]
  /** The deny rule that matched (deny only). */
  rule?: string
}

export interface ApprovalRequest {
  id: string
  sessionId: string
  actor?: string
  tool: string
  class: ActionClass
  reason: string
  input: unknown
  score?: number
  requestedAt: string
}

export interface ApprovalDecision {
  approve: boolean
  by?: string
  note?: string
}

export interface DenyRule {
  id: string
  description: string
  /** Returns a short description of what matched, or undefined. Gets every string found in the call's input. */
  matches(strings: string[]): string | undefined
}

export interface PolicyConfig {
  /** Paths are judged relative to this. Default: `process.cwd()`. */
  projectRoot?: string
  /** A real-fs-write is auto-allowed only if its combined score is at least this. Default 0.8. */
  confidenceThreshold?: number
  /** How long a hold waits before it is denied. Default 120000 ms. A hold nobody answers is a denial, never an allow. */
  approvalTimeoutMs?: number
  /** Called when a hold is created. Optional: `ctx.policy.resolve()` also settles one. A throw or a missing answer is a denial. */
  approver?: (req: ApprovalRequest) => Promise<ApprovalDecision> | ApprovalDecision
  /** Extra independent signals, added to the built-in path-criticality and diff-size signals. */
  signals?: Signal[]
  /** Extra deny rules, added to the built-ins. Built-ins cannot be removed. */
  extraDenyRules?: DenyRule[]
}

export class PolicyError extends Error {
  override name = 'PolicyError'
}
