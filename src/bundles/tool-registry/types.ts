/**
 * What kind of side effect a tool has. `bundle-policy-gates` (Phase 5) gates on
 * this, so it is REQUIRED at registration: an unclassified tool can't exist.
 * (`deny-listed` is a verdict on a specific action, not a property of a tool.)
 */
export type ActionClass = 'read-only' | 'sandbox-write' | 'real-fs-write' | 'external-side-effect'

export interface ToolContext {
  sessionId: string
  actor?: string
}

export interface ToolDefinition<I = any> {
  /** 1-64 chars of [A-Za-z0-9_-] (the intersection of what model APIs accept). */
  name: string
  description: string
  /** JSON Schema (must describe an object). Compiled at registration. */
  inputSchema: Record<string, unknown>
  actionClass: ActionClass
  execute(input: I, ctx: ToolContext): Promise<unknown> | unknown
}

/** Public, serialisable view of a tool. Structurally a superset of model-adapter's `ToolSpec`. */
export interface ToolInfo {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  actionClass: ActionClass
}

export type ToolErrorKind = 'unknown_tool' | 'invalid_input' | 'denied' | 'execution' | 'output'

export interface ToolResult {
  ok: boolean
  /** What the model sees. Always a string. */
  content: string
  errorKind?: ToolErrorKind
}

export interface ToolCallEvent {
  sessionId: string
  actor?: string
  tool: ToolInfo
  /** Deep-frozen copy: hooks can read but not alter what will execute. */
  input: unknown
}

export interface ToolResultEvent extends ToolCallEvent {
  /** Mutable on purpose: post-execute hooks may redact `content`. */
  result: ToolResult
}

/** Throw from a `tools/pre-execute` listener to block the call. */
export class ToolDeniedError extends Error {
  override name = 'ToolDeniedError'
}

/** Programmer errors at registration time (bad name, duplicate, bad schema). */
export class ToolRegistrationError extends Error {
  override name = 'ToolRegistrationError'
}
