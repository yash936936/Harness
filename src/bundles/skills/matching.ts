// Deterministic keyword and embedding matchers for selecting relevant skills.
import { SkillsConfigError, type SkillMatcher } from './types.js'

const STOP = new Set('a an and or of to in on is are it its be by for with as at we our do does how what why which that this from than so can not no use when the you your i me my if into out up about any all'.split(' '))
const wordsOf = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w)))

/**
 * Offline matcher: a skill matches when the task shares at least `minOverlap`
 * distinct content words with its name + description. Crude (no stemming, no
 * synonyms) and only as good as the descriptions are specific.
 */
export function keywordMatcher(opts: { minOverlap?: number } = {}): SkillMatcher {
  const min = opts.minOverlap ?? 2
  return (task, skills) => {
    const t = wordsOf(task)
    return skills
      .map((s) => ({ name: s.name, n: [...wordsOf(`${s.name.replace(/-/g, ' ')} ${s.description}`)].filter((w) => t.has(w)).length }))
      .filter((x) => x.n >= min)
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
      .map((x) => x.name)
  }
}

interface EmbedLike {
  embed(texts: string[], opts?: { kind?: 'document' | 'query' }): Promise<{ ok: true; vectors: number[][] } | { ok: false; error: { kind: string; detail: string } }>
}
const cosine = (a: number[], b: number[]) => {
  let d = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    d += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return na && nb ? d / Math.sqrt(na * nb) : 0
}

/**
 * Embedding matcher: cosine between the task and each skill's description.
 * `minScore` is REQUIRED and model-specific: with nomic-embed-text the measured
 * scores were ~0.43 for unrelated text and 0.53-0.61 for real matches (3.3 smoke),
 * so a value near 0.48 is a starting point, not a tuned setting. An embedding
 * failure throws; the auto-load section turns that into `lastAutoLoad.error`.
 */
export function embeddingMatcher(embeddings: EmbedLike, opts: { minScore: number }): SkillMatcher {
  if (!Number.isFinite(opts.minScore)) throw new SkillsConfigError('skills: embeddingMatcher needs a numeric minScore (it depends on the embedding model)')
  const cache = new Map<string, number[]>()
  return async (task, skills) => {
    const missing = skills.filter((s) => !cache.has(s.description))
    if (missing.length) {
      const r = await embeddings.embed(missing.map((s) => s.description), { kind: 'document' })
      if (!r.ok) throw new Error(`embedding failed: ${r.error.kind}: ${r.error.detail}`)
      missing.forEach((s, i) => cache.set(s.description, r.vectors[i]!))
    }
    const q = await embeddings.embed([task], { kind: 'query' })
    if (!q.ok) throw new Error(`embedding failed: ${q.error.kind}: ${q.error.detail}`)
    return skills
      .map((s) => ({ name: s.name, score: cosine(q.vectors[0]!, cache.get(s.description)!) }))
      .filter((x) => x.score >= opts.minScore)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .map((x) => x.name)
  }
}
