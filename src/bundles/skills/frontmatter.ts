/**
 * A deliberately small YAML reader for SKILL.md frontmatter (no YAML
 * dependency, D-065). It understands what the Agent Skills spec uses:
 *   key: plain value | "double" | 'single' | > folded block | | literal block
 *   metadata:            (one level of  `  key: value`  lines)
 * Everything else (flow collections, anchors, tags, nested maps under other
 * keys, multi-line quoted strings) is REJECTED with an error rather than
 * guessed at: a skill that needs real YAML fails loudly, it is never misread.
 * Values stay strings; nothing is coerced to a number or boolean.
 *
 * Lenient on purpose: a plain value may contain ": " (real YAML forbids it, and
 * descriptions like "Use when: the user asks..." are common). A ` #` starts a
 * comment, as in YAML.
 */
export interface ParsedSkillMd {
  meta: Record<string, string | Record<string, string>>
  body: string
}
export type ParseResult = ({ ok: true } & ParsedSkillMd) | { ok: false; error: string }

const FORBIDDEN_START = /^[[{&*!%@`|>]/ // `|` and `>` alone are block scalars, handled before this check

function unquote(raw: string, line: number): string | { error: string } {
  const q = raw[0]
  if (q === "'") {
    // '' is an escaped quote
    let out = ''
    for (let i = 1; i < raw.length; i++) {
      if (raw[i] === "'") {
        if (raw[i + 1] === "'") {
          out += "'"
          i++
          continue
        }
        const rest = raw.slice(i + 1).trim()
        if (rest && !rest.startsWith('#')) return { error: `line ${line}: unexpected text after the closing quote` }
        return out
      }
      out += raw[i]
    }
    return { error: `line ${line}: unclosed single quote (multi-line quoted strings are not supported; use a > block)` }
  }
  let out = ''
  for (let i = 1; i < raw.length; i++) {
    const c = raw[i]!
    if (c === '\\') {
      const n = raw[++i]
      if (n === 'n') out += '\n'
      else if (n === 't') out += '\t'
      else if (n === '"' || n === '\\' || n === '/') out += n
      else return { error: `line ${line}: unsupported escape \\${n ?? ''} in a double-quoted string` }
    } else if (c === '"') {
      const rest = raw.slice(i + 1).trim()
      if (rest && !rest.startsWith('#')) return { error: `line ${line}: unexpected text after the closing quote` }
      return out
    } else out += c
  }
  return { error: `line ${line}: unclosed double quote (multi-line quoted strings are not supported; use a > block)` }
}

/** Parse one scalar value written after `key:` on a single line. */
function scalar(raw: string, line: number): string | { error: string } {
  const v = raw.trim()
  if (v === '') return ''
  if (v[0] === '"' || v[0] === "'") return unquote(v, line)
  if (FORBIDDEN_START.test(v)) return { error: `line ${line}: unsupported YAML construct "${v[0]}" (flow collections, anchors and tags are not supported)` }
  const hash = v.search(/\s#/)
  return (hash >= 0 ? v.slice(0, hash) : v).trim()
}

export function parseSkillMd(text: string): ParseResult {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = src.split('\n')
  if (lines[0]!.trim() !== '---') return { ok: false, error: 'SKILL.md must start with a "---" frontmatter block' }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trimEnd() === '---') {
      end = i
      break
    }
  }
  if (end < 0) return { ok: false, error: 'frontmatter is not closed (no second "---" line)' }
  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '')

  const meta: ParsedSkillMd['meta'] = {}
  let i = 1
  while (i < end) {
    const raw = lines[i]!
    const ln = i + 1
    if (raw.trim() === '' || raw.trim().startsWith('#')) {
      i++
      continue
    }
    if (/^\s/.test(raw)) return { ok: false, error: `line ${ln}: unexpected indentation` }
    const m = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/.exec(raw.trimEnd())
    if (!m) return { ok: false, error: `line ${ln}: expected "key: value"` }
    const key = m[1]!
    const rest = (m[2] ?? '').trim()
    if (key in meta) return { ok: false, error: `line ${ln}: duplicate key "${key}"` }
    i++

    // block scalar
    const block = /^([>|])[+-]?$/.exec(rest)
    if (block) {
      const chunk: string[] = []
      while (i < end && (lines[i]!.trim() === '' || /^\s/.test(lines[i]!))) chunk.push(lines[i++]!)
      while (chunk.length && chunk[chunk.length - 1]!.trim() === '') chunk.pop()
      const indent = Math.min(...chunk.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length), Infinity)
      const dedented = chunk.map((l) => (l.trim() ? l.slice(indent) : ''))
      meta[key] =
        block[1] === '|'
          ? dedented.join('\n')
          : dedented.reduce((acc, l) => (l === '' ? acc + '\n' : acc === '' || acc.endsWith('\n') ? acc + l : acc + ' ' + l), '')
      continue
    }

    if (rest === '' || rest.startsWith('#')) {
      // either an empty value or a nested map on the following indented lines
      const nested: string[] = []
      while (i < end && (lines[i]!.trim() === '' || /^\s/.test(lines[i]!))) nested.push(lines[i++]!)
      const real = nested.filter((l) => l.trim() && !l.trim().startsWith('#'))
      if (real.length === 0) {
        meta[key] = ''
        continue
      }
      if (key !== 'metadata') return { ok: false, error: `line ${ln}: "${key}" has a nested value, which is only supported for "metadata"` }
      const map: Record<string, string> = {}
      // One level only: every entry must sit at the same indentation, otherwise a deeper line is a nested map we would flatten.
      const indents = new Set(real.map((l) => /^\s*/.exec(l)![0].length))
      if (indents.size > 1) return { ok: false, error: 'metadata: entries must all be at the same indentation (nested maps and lists are not supported)' }
      for (const l of real) {
        const mm = /^\s+([A-Za-z0-9_.-]+):(?:[ \t]+(.*))?$/.exec(l.trimEnd())
        if (!mm) return { ok: false, error: `metadata: expected "  key: value", got "${l.trim()}" (nested maps and lists are not supported)` }
        const v = scalar(mm[2] ?? '', ln)
        if (typeof v !== 'string') return { ok: false, error: `metadata.${mm[1]}: ${v.error}` }
        if (mm[1]! in map) return { ok: false, error: `metadata: duplicate key "${mm[1]}"` }
        map[mm[1]!] = v
      }
      meta[key] = map
      continue
    }

    const v = scalar(rest, ln)
    if (typeof v !== 'string') return { ok: false, error: v.error }
    meta[key] = v
  }
  return { ok: true, meta, body }
}
