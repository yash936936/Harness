import { createHash } from 'node:crypto'
import type { CodeSymbol } from '../retrieval-treesitter/types.js'

export interface Chunk {
  file: string
  /** 1-based, inclusive. */
  startLine: number
  endLine: number
  kind: 'symbol' | 'window'
  /** Qualified symbol name for `kind: 'symbol'`. */
  name?: string
  text: string
  /** `file#start-end#<hash of text>`: changes whenever the chunk's text changes. */
  id: string
}

export interface ChunkOptions {
  /** Size of windows over code that is not inside any symbol. Default 40 lines. */
  windowLines: number
  /** A symbol longer than this is split into windows of this size. Default 80 lines. */
  maxChunkLines: number
  /** Hard cap on a chunk's text. Default 6000 characters. */
  maxChunkChars: number
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { windowLines: 40, maxChunkLines: 80, maxChunkChars: 6000 }

export function splitLines(source: string): string[] {
  return source.split(/\r?\n/)
}

/** The text of lines `start..end` (1-based, inclusive), exactly as a chunk stores it. */
export function sliceChunkText(lines: readonly string[], start: number, end: number, maxChars: number): string {
  return lines.slice(start - 1, end).join('\n').slice(0, maxChars)
}

export function textHash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12)
}

export function chunkId(file: string, start: number, end: number, text: string): string {
  return `${file}#${start}-${end}#${textHash(text)}`
}

/**
 * Split a file into retrievable chunks: one per symbol (long ones in windows), plus fixed-size
 * windows over everything outside symbols (imports, top-level code, config and prose files, and
 * whole files in languages without a grammar). Whitespace-only windows are dropped.
 */
export function chunkSource(file: string, source: string, symbols: readonly CodeSymbol[] | undefined, opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS): Chunk[] {
  const lines = splitLines(source)
  const total = source === '' ? 0 : lines.length
  const out: Chunk[] = []
  const seen = new Set<string>()

  const add = (start: number, end: number, kind: Chunk['kind'], name?: string): void => {
    const key = `${start}-${end}`
    if (seen.has(key)) return
    const text = sliceChunkText(lines, start, end, opts.maxChunkChars)
    if (text.trim() === '') return
    seen.add(key)
    out.push({ file, startLine: start, endLine: end, kind, ...(name ? { name } : {}), text, id: chunkId(file, start, end, text) })
  }

  const covered = new Array<boolean>(total + 2).fill(false)
  for (const s of symbols ?? []) {
    const start = Math.max(1, s.startLine)
    const end = Math.min(total, s.endLine)
    if (end < start) continue
    for (let l = start; l <= end; l++) covered[l] = true
    for (let a = start; a <= end; a += opts.maxChunkLines) add(a, Math.min(end, a + opts.maxChunkLines - 1), 'symbol', s.qualifiedName)
  }

  let l = 1
  while (l <= total) {
    if (covered[l]) {
      l++
      continue
    }
    let runEnd = l
    while (runEnd + 1 <= total && !covered[runEnd + 1]) runEnd++
    for (let a = l; a <= runEnd; a += opts.windowLines) add(a, Math.min(runEnd, a + opts.windowLines - 1), 'window')
    l = runEnd + 1
  }

  return out.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine)
}

/** True if the first bytes contain a NUL: treat the file as binary and do not index it. */
export function looksBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}
