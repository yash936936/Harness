import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from 'cordis'
import { MemoryError, type HotEntry, type HotRender, type HotView } from './types.js'
import { SCOPED_ACTOR_PREFIX, isScopedActor } from './access.js'

export const HOT_HEADER = '## Standing rules and facts (hot memory)'

/** Conservative: code and symbols tokenize denser than prose, so 3 chars/token rather than 4. */
export function defaultEstimateTokens(text: string): number {
  return Math.ceil(text.length / 3)
}

/** One line, so a stored entry can never forge a heading or a second list item. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * The hot tier (3.2): a small, curated set of rules and facts shown to the
 * model on every run, under a hard token cap.
 *
 * Unlike the episodic tier this one IS editable (add/replace/remove): it is a
 * working set that compaction (3.4) and the owner revise, not a record.
 * Trimming drops whole entries, lowest priority first (ties: oldest first);
 * it never cuts an entry in half, because half a rule can mean the opposite.
 */
export class HotTier {
  private entries: HotEntry[] | undefined
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private ctx: Context,
    private dir: string | undefined,
    readonly tokenCap: number,
    private estimate: (text: string) => number,
    private now: () => Date,
  ) {
    if (!(tokenCap > 0)) throw new MemoryError('memory: hotTokenCap must be positive')
  }

  private line(e: HotEntry) {
    return `- ${oneLine(e.text)}`
  }

  /** Estimated tokens one entry costs once rendered (its line, plus the newline). */
  cost(text: string): number {
    return this.estimate(`${this.line({ text } as HotEntry)}\n`)
  }

  async add(input: { text: string; priority?: number; id?: string; source?: string; scope?: string }): Promise<HotEntry> {
    if (input.scope !== undefined && !isScopedActor(input.scope)) {
      throw new MemoryError(`memory: hot scope must be a sub-agent actor ("${SCOPED_ACTOR_PREFIX}<id>"), got ${JSON.stringify(input.scope)}`)
    }
    const priority = input.priority ?? 0
    if (!Number.isFinite(priority)) throw new MemoryError('memory: hot priority must be a finite number')
    let text = oneLine(input.text ?? '')
    if (!text) throw new MemoryError('memory: hot entry text is empty')
    text = this.ctx.egress.redactValue(text)
    // An entry that can never fit is refused now, loudly, rather than stored and never shown.
    if (this.estimate(HOT_HEADER + '\n') + this.cost(text) > this.tokenCap) {
      throw new MemoryError(`memory: hot entry is too large for the ${this.tokenCap}-token hot tier; shorten it or store it in the semantic tier`)
    }
    const entry: HotEntry = {
      id: input.id ?? randomUUID(),
      text,
      priority,
      ts: this.now().toISOString(),
      ...(input.source ? { source: input.source } : {}),
      ...(input.scope ? { scope: input.scope } : {}),
    }
    await this.mutate((list) => {
      const i = list.findIndex((e) => e.id === entry.id)
      if (i >= 0) list[i] = entry
      else list.push(entry)
    })
    return entry
  }

  async remove(id: string): Promise<boolean> {
    let found = false
    await this.mutate((list) => {
      const i = list.findIndex((e) => e.id === id)
      if (i >= 0) {
        list.splice(i, 1)
        found = true
      }
    })
    return found
  }

  async list(): Promise<HotEntry[]> {
    return structuredClone(await this.load())
  }

  /** Highest priority first; among equals, newest first. Greedy: an entry too big for the room left is skipped, smaller ones may still fit. */
  async render(view: HotView = {}): Promise<HotRender> {
    const all = await this.load()
    // Filter to what THIS viewer may see first: the cap is spent only on visible entries, so another agent's rules cannot crowd mine out.
    const visible = view.none ? [] : all.filter((e) => (e.scope === undefined ? view.globals !== false : e.scope === view.scope))
    if (visible.length === 0) return { text: '', tokens: 0, included: [], dropped: [] }
    const ranked = [...visible].sort((a, b) => b.priority - a.priority || (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    let used = this.estimate(HOT_HEADER + '\n')
    const included: HotEntry[] = []
    const dropped: string[] = []
    for (const e of ranked) {
      const c = this.estimate(`${this.line(e)}\n`)
      if (used + c <= this.tokenCap) {
        included.push(e)
        used += c
      } else dropped.push(e.id)
    }
    if (included.length === 0) return { text: '', tokens: 0, included: [], dropped }
    const text = `${HOT_HEADER}\n${included.map((e) => this.line(e)).join('\n')}`
    // The text we hand over is re-measured as one string, so a non-additive estimator cannot sneak past the cap.
    return { text, tokens: this.estimate(text), included: included.map((e) => e.id), dropped }
  }

  private get file() {
    return join(this.dir!, 'hot.json')
  }

  private async load(): Promise<HotEntry[]> {
    if (this.entries) return this.entries
    this.entries = []
    if (this.dir) {
      try {
        const parsed = JSON.parse(await readFile(this.file, 'utf8'))
        if (!Array.isArray(parsed)) throw new Error('not an array')
        this.entries = parsed
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          this.entries = undefined
          throw new MemoryError(`memory: hot.json is unreadable (${err?.message ?? err}); refusing to overwrite it`)
        }
      }
    }
    return this.entries!
  }

  /** Serialised read-modify-write; the file is replaced atomically (temp file + rename). */
  private mutate(fn: (list: HotEntry[]) => void): Promise<void> {
    const job = this.queue.then(async () => {
      const list = structuredClone(await this.load())
      fn(list)
      if (this.dir) {
        await mkdir(this.dir, { recursive: true })
        const tmp = `${this.file}.${process.pid}.tmp`
        await writeFile(tmp, JSON.stringify(list, null, 2), 'utf8')
        await rename(tmp, this.file)
      }
      this.entries = list
    })
    this.queue = job.catch(() => {})
    return job
  }
}
