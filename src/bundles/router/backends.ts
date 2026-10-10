import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import type { Candidate, DecisionClass, RouterBackend } from './types.js'

const STOP = new Set('a an the and or of to in on for with from by is are be it this that as at into then it its do does how what which use using please can you i we our my your'.split(' '))
const tokens = (s: string): string[] => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOP.has(t)).map((t) => (t.length > 4 ? t.replace(/(ing|ed|es|s)$/, '') : t))

/**
 * Fallback 2: deterministic token overlap between the task and each candidate's id + description. Abstains unless one
 * candidate scores >= 1 AND strictly beats the runner-up, so it never guesses between ties.
 */
export class RulesBackend implements RouterBackend {
  readonly name = 'rules' as const
  async decide(_cls: DecisionClass, req: { task: string; candidates: Candidate[] }): Promise<string | null> {
    const t = new Set(tokens(req.task))
    const scored = req.candidates.map((c) => ({ id: c.id, score: new Set(tokens(`${c.id.replace(/[_-]/g, ' ')} ${c.description}`)).size === 0 ? 0 : [...new Set(tokens(`${c.id.replace(/[_-]/g, ' ')} ${c.description}`))].filter((x) => t.has(x)).length }))
    scored.sort((a, b) => b.score - a.score)
    if (!scored[0] || scored[0].score < 1) return null
    if (scored[1] && scored[1].score === scored[0].score) return null
    return scored[0].id
  }
}

export interface WorkerLike {
  complete(req: { sessionId: string; system?: string; messages: Array<{ role: 'user'; content: string }>; maxTokens?: number; temperature?: number }): Promise<{ text: string }>
}

/** Fallback 3 and the baseline Needle must beat: ask the worker model, one request per decision. */
export class WorkerBackend implements RouterBackend {
  readonly name = 'worker' as const
  readonly requestCost = 1
  constructor(private readonly llm: WorkerLike, private readonly sessionId = 'router') {}
  async decide(cls: DecisionClass, req: { task: string; candidates: Candidate[] }): Promise<string | null> {
    const list = req.candidates.map((c) => `- ${c.id}: ${c.description}`).join('\n')
    const r = await this.llm.complete({
      sessionId: this.sessionId,
      system: `You route a task to exactly one ${cls}. Reply with ONLY the id of the best one, nothing else. If none fits, reply NONE.`,
      messages: [{ role: 'user', content: `Task: ${req.task}\n\nOptions:\n${list}` }],
      maxTokens: 20,
      temperature: 0,
    })
    const text = r.text.trim().replace(/^["'`]+|["'`.]+$/g, '')
    return text.toUpperCase() === 'NONE' ? null : text
  }
}

export interface CommandBackendConfig {
  /** Executable that speaks the stdio contract below. For Needle this is a thin wrapper YOU supply and verify (see docs). */
  command: string
  args?: string[]
  /** Files that must exist for the backend to count as installed. Missing = skipped silently (the delete-Needle case). */
  requiredFiles?: string[]
  /** If set, the first required file must hash to this, checked once (streamed). A mismatch disables the backend. */
  expectedSha256?: string
  timeoutMs?: number
  name?: 'needle'
}

export async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256')
  await new Promise<void>((res, rej) => createReadStream(path).on('data', (d) => h.update(d)).on('end', () => res()).on('error', rej))
  return h.digest('hex')
}

/**
 * Talks to an external process: one JSON line in `{"class","task","candidates":[{"id","description"}]}`, one JSON line out
 * `{"choice":"<id>"|null}`, then it exits. A hang is killed at the timeout. Nothing here assumes how Needle is run:
 * the wrapper that loads the model is outside this repo, and the Cactus runtime's real interface is unverified (D-050).
 */
export class CommandBackend implements RouterBackend {
  readonly name: 'needle'
  private verified: { ok: boolean; why?: string } | undefined
  constructor(private readonly cfg: CommandBackendConfig) {
    this.name = cfg.name ?? 'needle'
  }

  async available(): Promise<{ ok: boolean; why?: string }> {
    if (this.verified) return this.verified
    const missing = (this.cfg.requiredFiles ?? []).filter((f) => !existsSync(f))
    if (missing.length) return (this.verified = { ok: false, why: `not installed (missing ${missing[0]})` })
    if (this.cfg.expectedSha256 && this.cfg.requiredFiles?.[0]) {
      try {
        const got = await sha256File(this.cfg.requiredFiles[0])
        if (got !== this.cfg.expectedSha256.toLowerCase()) return (this.verified = { ok: false, why: 'weights do not match the pinned sha256' })
      } catch (e: any) {
        return (this.verified = { ok: false, why: `cannot read weights: ${String(e?.message ?? e).slice(0, 80)}` })
      }
    }
    return (this.verified = { ok: true })
  }

  decide(cls: DecisionClass, req: { task: string; candidates: Candidate[] }): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const p = spawn(this.cfg.command, this.cfg.args ?? [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { PATH: process.env['PATH'] ?? '', SystemRoot: process.env['SystemRoot'] ?? '', NEEDLE_TELEMETRY: '0' } })
      let out = ''
      let done = false
      const finish = (f: () => void) => { if (!done) { done = true; clearTimeout(timer); f() } }
      const timer = setTimeout(() => { p.kill('SIGKILL'); finish(() => reject(new Error('router backend timed out'))) }, this.cfg.timeoutMs ?? 5000)
      p.stdout.on('data', (d) => { out += d; if (out.length > 4096) { p.kill('SIGKILL'); finish(() => reject(new Error('router backend output too large'))) } })
      p.on('error', (e) => finish(() => reject(e)))
      p.on('close', () => finish(() => {
        try {
          const j = JSON.parse(out.trim().split('\n')[0] ?? '')
          resolve(typeof j?.choice === 'string' ? j.choice : null)
        } catch {
          reject(new Error('router backend returned invalid JSON'))
        }
      }))
      p.stdin.on('error', () => {})
      p.stdin.end(JSON.stringify({ class: cls, task: req.task, candidates: req.candidates.map(({ id, description }) => ({ id, description })) }) + '\n')
    })
  }
}
