import type { SessionEvent } from '../session-log/index.js'

const TOOL_RE = /^[A-Za-z0-9_-]{1,64}$/
const RULE_RE = /^[A-Za-z0-9_.-]{1,40}$/

/**
 * A lesson for one turn, written by a TEMPLATE from facts the harness itself produced, never from text a model or a file wrote (D-083).
 * Fields that can appear in a lesson are only: a registered tool name, an error kind, a deny-rule id and an approval outcome, each checked
 * against a strict pattern, so a lesson cannot carry an injected sentence and a lesson that recurs into a standing rule (compaction, D-064)
 * is bounded to this small set of sentences. At most one lesson per turn, in this order: a deny-list block, a refused or unanswered
 * approval, then a failed call. A turn with none of these has no lesson (`null`): success teaches nothing here.
 */
export function deriveLesson(events: SessionEvent[], fromSeq: number, toSeq: number): string | null {
  const inRange = events.filter((e) => e.seq >= fromSeq && e.seq <= toSeq)
  const tool = (v: unknown) => (typeof v === 'string' && TOOL_RE.test(v) ? v : undefined)

  for (const e of inRange) {
    const d = e.data as { verdict?: string; tool?: string; rule?: string }
    if (e.type === 'policy.decision' && d.verdict === 'deny') {
      const t = tool(d.tool)
      if (!t) continue
      const rule = typeof d.rule === 'string' && RULE_RE.test(d.rule) ? `deny rule ${d.rule}` : 'a deny rule'
      return `A call to ${t} was blocked by ${rule}; do not attempt that kind of call.`
    }
  }
  for (const e of inRange) {
    const d = e.data as { outcome?: string; tool?: string }
    if (e.type === 'approval.resolved' && (d.outcome === 'denied' || d.outcome === 'timeout')) {
      const t = tool(d.tool)
      if (!t) continue
      return `A call to ${t} needed approval and ${d.outcome === 'timeout' ? 'got no answer' : 'was refused'}; prefer a smaller, safer change or ask first.`
    }
  }
  for (const e of inRange) {
    const d = e.data as { ok?: boolean; name?: string; errorKind?: string }
    if (e.type !== 'tool.result' || d.ok !== false) continue
    if (d.errorKind === 'unknown_tool') return 'A call named a tool that is not available; use only the tools offered.'
    const t = tool(d.name)
    if (!t) continue
    if (d.errorKind === 'invalid_input') return `${t} rejected its input as invalid; check the tool's input schema before calling it.`
    if (d.errorKind === 'execution') return `${t} failed while running; read the error and change the call before retrying.`
  }
  return null
}
