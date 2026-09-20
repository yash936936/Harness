import { Context, Service } from 'cordis'
import Ajv from 'ajv'
import '../session-log/index.js'
import {
  ToolDeniedError,
  ToolRegistrationError,
  type ToolCallEvent,
  type ToolContext,
  type ToolDefinition,
  type ToolInfo,
  type ToolResult,
  type ToolResultEvent,
} from './types.js'

export * from './types.js'

export interface ToolRegistryConfig {
  /** Tool output longer than this is truncated before the model or log sees it. */
  maxOutputChars?: number
}

declare module 'cordis' {
  interface Context {
    tools: ToolRegistry
  }
  interface Events {
    /** Serial. Throw `ToolDeniedError` to block. Any other throw also blocks (fail closed). */
    'tools/pre-execute'(ev: ToolCallEvent): void | Promise<void>
    /** Serial. May mutate `ev.result` (e.g. redaction). A throw replaces the result with an error. */
    'tools/post-execute'(ev: ToolResultEvent): void | Promise<void>
  }
}

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/

interface Entry {
  def: ToolDefinition
  validate: (input: unknown) => boolean
  errors: () => string
}

/**
 * `ctx.tools` — tools self-register; there is no central list.
 *
 * This is also the single choke point every tool call goes through, which is
 * why logging and the `tools/pre-execute` / `tools/post-execute` hooks live
 * here: a call path that skipped them would bypass policy and the audit trail.
 */
export class ToolRegistry extends Service {
  static inject = ['log']

  private entries = new Map<string, Entry>()
  private ajv = new Ajv({ strict: false })
  private maxOutput: number

  constructor(ctx: Context, config: ToolRegistryConfig = {}) {
    super(ctx, 'tools')
    this.maxOutput = config.maxOutputChars ?? 50_000
  }

  /** Register a tool. Returns a disposer; call it inside `ctx.effect` so it unregisters with its plugin. */
  register(def: ToolDefinition): () => void {
    if (!NAME_RE.test(def.name)) throw new ToolRegistrationError(`invalid tool name ${JSON.stringify(def.name)} (use 1-64 of A-Z a-z 0-9 _ -)`)
    if (!def.description?.trim()) throw new ToolRegistrationError(`tool "${def.name}": description is required`)
    if (!def.actionClass) throw new ToolRegistrationError(`tool "${def.name}": actionClass is required`)
    if (typeof def.execute !== 'function') throw new ToolRegistrationError(`tool "${def.name}": execute must be a function`)
    if (def.inputSchema?.['type'] !== 'object') throw new ToolRegistrationError(`tool "${def.name}": inputSchema must have type "object"`)
    if (this.entries.has(def.name)) {
      throw new ToolRegistrationError(`tool "${def.name}" is already registered; refusing to overwrite`)
    }
    let validate: ReturnType<Ajv['compile']>
    try {
      validate = this.ajv.compile(def.inputSchema)
    } catch (e: any) {
      throw new ToolRegistrationError(`tool "${def.name}": invalid inputSchema (${e?.message ?? e})`)
    }
    const entry: Entry = {
      def,
      validate: (i) => validate(i) as boolean,
      errors: () => this.ajv.errorsText(validate.errors, { dataVar: 'input' }),
    }
    this.entries.set(def.name, entry)
    return () => {
      if (this.entries.get(def.name) === entry) this.entries.delete(def.name)
    }
  }

  has(name: string): boolean {
    return this.entries.has(name)
  }

  list(): ToolInfo[] {
    return [...this.entries.values()].map((e) => info(e.def))
  }

  /**
   * Execute a tool. Tool-level failures (unknown tool, bad input, denial, the
   * tool throwing) come back as `{ ok: false }` so the model can see and
   * recover from them; they never throw. Only infrastructure failures do
   * (e.g. the session log can't be written), because a call that can't be
   * logged must not run and a result that can't be logged must not be returned.
   */
  async call(name: string, input: unknown, tctx: ToolContext): Promise<ToolResult> {
    const { sessionId, actor } = tctx
    const log = this.ctx.log

    await log.append(sessionId, 'tool.call', { name, input }, actor)

    const finish = async (result: ToolResult): Promise<ToolResult> => {
      await log.append(sessionId, 'tool.result', { name, ...result }, actor)
      return result
    }
    const fail = (errorKind: NonNullable<ToolResult['errorKind']>, content: string) => finish({ ok: false, content, errorKind })

    const entry = this.entries.get(name)
    if (!entry) {
      const avail = this.list().map((t) => t.name).join(', ') || 'none'
      return fail('unknown_tool', `Unknown tool "${name}". Available tools: ${avail}.`)
    }

    if (!entry.validate(input)) return fail('invalid_input', `Invalid input for tool "${name}": ${entry.errors()}.`)

    const tool = info(entry.def)
    const frozen = deepFreeze(structuredClone(input))
    const callEv: ToolCallEvent = { sessionId, ...(actor ? { actor } : {}), tool, input: frozen }

    try {
      await this.ctx.serial('tools/pre-execute', callEv)
    } catch (e: any) {
      const why = e?.message ?? String(e)
      if (e instanceof ToolDeniedError) return fail('denied', `Tool "${name}" was blocked: ${why}`)
      return fail('denied', `Tool "${name}" was blocked because a pre-execute hook failed: ${why}`)
    }

    let result: ToolResult
    try {
      const out = await entry.def.execute(frozen, { sessionId, ...(actor ? { actor } : {}) })
      result = { ok: true, content: this.render(out) }
    } catch (e: any) {
      result = { ok: false, errorKind: 'execution', content: this.truncate(`Tool "${name}" failed: ${e?.message ?? String(e)}`) }
    }

    const postEv: ToolResultEvent = { ...callEv, result }
    try {
      await this.ctx.serial('tools/post-execute', postEv)
      result = postEv.result
    } catch (e: any) {
      // Fail closed: don't let unscanned output through if a post hook broke.
      result = { ok: false, errorKind: 'denied', content: `Tool "${name}" result withheld because a post-execute hook failed: ${e?.message ?? String(e)}` }
    }
    return finish(result)
  }

  private render(out: unknown): string {
    if (typeof out === 'string') return this.truncate(out)
    if (out === undefined) return ''
    try {
      return this.truncate(JSON.stringify(out))
    } catch {
      return this.truncate(String(out))
    }
  }

  private truncate(s: string): string {
    return s.length > this.maxOutput ? `${s.slice(0, this.maxOutput)}\n[output truncated: ${s.length - this.maxOutput} more characters]` : s
  }
}

function info(d: ToolDefinition): ToolInfo {
  return { name: d.name, description: d.description, inputSchema: d.inputSchema, actionClass: d.actionClass }
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const k of Object.keys(v as object)) deepFreeze((v as any)[k])
  }
  return v
}

export const name = 'bundle-tool-registry'
export function apply(ctx: Context, config: ToolRegistryConfig = {}) {
  ctx.plugin(ToolRegistry, config)
}
