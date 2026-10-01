/** Identifier-aware tokenising, query-term extraction and BM25 (pure functions). */

const WORDS = /[\p{L}\p{N}]+/gu

/** `parseHTTPServer2` -> `parse http server 2`; underscores, dots and dashes already split words. */
function splitCamel(word: string): string[] {
  return word
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .toLowerCase()
    .split(' ')
}

/**
 * Lower-case word tokens. An identifier that splits into several parts yields the parts AND the
 * whole identifier, so `parseConfigFile` matches a search for "config" as well as for the exact
 * name. Single characters are dropped.
 */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(WORDS)) {
    const word = m[0]
    const parts = splitCamel(word)
    for (const p of parts) if (p.length >= 2) out.push(p)
    if (parts.length > 1) {
      const whole = word.toLowerCase()
      if (whole.length >= 2) out.push(whole)
    }
  }
  return out
}

const STOPWORDS = new Set(
  ('a an and are as at be but by can do does for from how i if in into is it its me my of on or our so than that the their them then there these ' +
    'they this to was we what when where which who why will with you your about find show give get use using used code function file').split(' '),
)

/**
 * `tokens`: what BM25 scores against (stopwords removed, duplicates removed, order kept).
 * `grepTerms`: the subset used to find candidate files (3+ characters, at most `maxTerms`). Tokens
 * are made of letters and digits only, so they are safe to join into a regex with `|` as they are.
 */
export function queryTerms(query: string, maxTerms = 12): { tokens: string[]; grepTerms: string[] } {
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const t of tokenize(query)) {
    if (STOPWORDS.has(t) || seen.has(t)) continue
    seen.add(t)
    tokens.push(t)
  }
  const grepTerms = tokens.filter((t) => t.length >= 3).slice(0, maxTerms)
  return { tokens, grepTerms }
}

export interface Bm25Params {
  k1: number
  b: number
}

/**
 * Okapi BM25 over a small corpus (the candidate chunks), idf = ln(1 + (N - n + 0.5) / (n + 0.5)),
 * so it is never negative. Returns one score per document, in order. Repeated query terms count once.
 */
export function bm25(docs: readonly (readonly string[])[], queryTokens: readonly string[], params: Bm25Params = { k1: 1.2, b: 0.75 }): number[] {
  const N = docs.length
  if (N === 0) return []
  const terms = [...new Set(queryTokens)]
  const tfs = docs.map((d) => {
    const m = new Map<string, number>()
    for (const t of d) m.set(t, (m.get(t) ?? 0) + 1)
    return m
  })
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / N
  const idf = new Map<string, number>()
  for (const t of terms) {
    let n = 0
    for (const tf of tfs) if (tf.has(t)) n++
    idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)))
  }
  return docs.map((d, i) => {
    const tf = tfs[i] as Map<string, number>
    const norm = 1 - params.b + (avgLen > 0 ? params.b * (d.length / avgLen) : 0)
    let score = 0
    for (const t of terms) {
      const f = tf.get(t)
      if (f) score += (idf.get(t) as number) * ((f * (params.k1 + 1)) / (f + params.k1 * norm))
    }
    return score
  })
}
