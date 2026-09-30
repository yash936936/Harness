import { Context } from 'cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Language, Parser, Tree } from 'web-tree-sitter'
import {
  languageForFilename,
  RetrievalTreesitter,
  RetrievalTreesitterConfigError,
  type CodeSymbol,
  type RetrievalTreesitterConfig,
} from '../src/bundles/retrieval-treesitter/index.js'

async function boot(config: RetrievalTreesitterConfig = {}) {
  const ctx = new Context()
  const fiber = await ctx.plugin(RetrievalTreesitter, config)
  return { ctx, fiber, svc: ctx.retrievalParse }
}

async function symbolsOf(source: string, filename: string, config: RetrievalTreesitterConfig = {}) {
  const { svc } = await boot(config)
  const r = await svc.parse(source, { filename })
  if (!r.ok) throw new Error(`parse failed: ${JSON.stringify(r.error)}`)
  return r.file
}

const row = (s: CodeSymbol) => [s.kind, s.qualifiedName, s.startLine, s.endLine, s.exported] as const

describe('languageForFilename', () => {
  it('maps extensions, case-insensitively', () => {
    expect(languageForFilename('a.ts')).toBe('typescript')
    expect(languageForFilename('x/y/types.d.ts')).toBe('typescript')
    expect(languageForFilename('A.MTS')).toBe('typescript')
    expect(languageForFilename('c.tsx')).toBe('tsx')
    for (const f of ['a.js', 'a.mjs', 'a.cjs', 'a.jsx']) expect(languageForFilename(f)).toBe('javascript')
    expect(languageForFilename('m.py')).toBe('python')
  })
  it('returns undefined for anything else', () => {
    for (const f of ['README.md', 'Makefile', 'a.tsx.bak', 'noext', '']) expect(languageForFilename(f)).toBeUndefined()
  })
})

const TS = `// 😀 héllo wörld 日本語
import x from 'y'
export function alpha(a: number): string { return '' }
export async function* gen() {}
function hidden() {}
export const arrow = (a: number) => a
const notFn = 5
@Component({})
export default class Foo extends Bar {
  constructor() { super() }
  static make(): Foo { return new Foo() }
  private helper = () => 1
  get value() { return 1 }
  ['computed']() {}
  'quoted'() {}
}
export abstract class Abs { abstract run(): void }
export interface Shape { area(): number }
export type Id = string
enum Color { Red }
namespace NS { export function inner() {} }
declare function ambient(): void
`

describe('TypeScript extraction', () => {
  it('extracts the expected symbols with correct lines, nesting and export flags', async () => {
    const f = await symbolsOf(TS, 'a.ts')
    expect(f.language).toBe('typescript')
    expect(f.hasErrors).toBe(false)
    expect(f.symbols.map(row)).toEqual([
      ['function', 'alpha', 3, 3, true],
      ['function', 'gen', 4, 4, true],
      ['function', 'hidden', 5, 5, false],
      ['function', 'arrow', 6, 6, true],
      ['class', 'Foo', 8, 16, true], // starts at the decorator line
      ['method', 'Foo.constructor', 10, 10, true],
      ['method', 'Foo.make', 11, 11, true],
      ['method', 'Foo.helper', 12, 12, true],
      ['method', 'Foo.value', 13, 13, true],
      ['method', 'Foo.quoted', 15, 15, true], // computed ['computed'] is skipped, quoted key is unquoted
      ['class', 'Abs', 17, 17, true],
      ['method', 'Abs.run', 17, 17, true],
      ['interface', 'Shape', 18, 18, true],
      ['type', 'Id', 19, 19, true],
      ['enum', 'Color', 20, 20, false],
      ['namespace', 'NS', 21, 21, false],
      ['function', 'NS.inner', 21, 21, true], // exported from its namespace
      ['function', 'ambient', 22, 22, false],
    ])
    expect(f.lineCount).toBe(23)
  })

  it('signatures stop at the body, are one line, and survive non-ASCII text before them', async () => {
    const f = await symbolsOf(TS, 'a.ts')
    const sig = (n: string) => f.symbols.find((s) => s.qualifiedName === n)!.signature
    expect(sig('alpha')).toBe('function alpha(a: number): string')
    expect(sig('Abs.run')).toBe('abstract run(): void')
    expect(sig('Foo')).toBe('class Foo extends Bar')
    expect(sig('arrow')).toBe('const arrow = (a: number) => a')
  })

  it('handles overloads, nested namespaces and export namespace', async () => {
    const f = await symbolsOf(
      `function o(a: string): void\nfunction o(a: number): void\nfunction o(a: any) {}\nexport namespace A { export class K { m() {} } }\n`,
      'o.ts',
    )
    expect(f.symbols.map(row)).toEqual([
      ['function', 'o', 1, 1, false],
      ['function', 'o', 2, 2, false],
      ['function', 'o', 3, 3, false],
      ['namespace', 'A', 4, 4, true],
      ['class', 'A.K', 4, 4, true],
      ['method', 'A.K.m', 4, 4, true],
    ])
  })
})

describe('ambient module augmentation', () => {
  it("skips `declare module 'pkg' {}` (it augments another module) but keeps real declarations around it", async () => {
    const f = await symbolsOf(
      `declare module 'cordis' {\n  interface Context { foo: Foo }\n}\nexport class Foo {}\ndeclare namespace Real { function inner(): void }\n`,
      'aug.ts',
    )
    expect(f.symbols.map((s) => s.qualifiedName)).toEqual(['Foo', 'Real', 'Real.inner'])
  })
})

describe('other languages', () => {
  it('JavaScript: functions, classes, methods, function-valued consts', async () => {
    const f = await symbolsOf(`function g() {}\nclass B {\n  k() {}\n}\nconst h = function () {}\nmodule.exports = { g }\n`, 'a.js')
    expect(f.language).toBe('javascript')
    expect(f.symbols.map(row)).toEqual([
      ['function', 'g', 1, 1, false],
      ['class', 'B', 2, 4, false],
      ['method', 'B.k', 3, 3, true],
      ['function', 'h', 5, 5, false],
    ])
  })

  it('TSX: parses JSX that the plain TypeScript grammar would reject', async () => {
    const f = await symbolsOf(`export const C = () => <div className="x">hi</div>\n`, 'c.tsx')
    expect(f.language).toBe('tsx')
    expect(f.hasErrors).toBe(false)
    expect(f.symbols.map(row)).toEqual([['function', 'C', 1, 1, true]])
    const asTs = await symbolsOf(`export const C = () => <div className="x">hi</div>\n`, 'c.ts')
    expect(asTs.hasErrors).toBe(true) // control: proves the tsx grammar is really the one in use
  })

  it('Python: decorators in range, async, methods, nested class, no descent into function bodies', async () => {
    const py = `import os
@decorator
def top(x):
    def nested(): pass
    return x
async def atop(): pass
def _private(): pass
class Foo(Base):
    """doc"""
    def m(self): pass
    @property
    def prop(self): return 1
    class Inner:
        def deep(self): pass
`
    const f = await symbolsOf(py, 'a.py')
    expect(f.symbols.map(row)).toEqual([
      ['function', 'top', 2, 5, true],
      ['function', 'atop', 6, 6, true],
      ['function', '_private', 7, 7, false],
      ['class', 'Foo', 8, 14, true],
      ['method', 'Foo.m', 10, 10, true],
      ['method', 'Foo.prop', 11, 12, true],
      ['class', 'Foo.Inner', 13, 14, true],
      ['method', 'Foo.Inner.deep', 14, 14, true],
    ])
    expect(f.symbols.find((s) => s.name === 'top')!.signature).toBe('def top(x):')
    expect(f.symbols.some((s) => s.name === 'nested')).toBe(false)
  })
})

describe('robustness', () => {
  it('reports syntax errors but still returns what it could parse', async () => {
    const f = await symbolsOf(`export function good() {}\nfunction broken( {\n`, 'b.ts')
    expect(f.hasErrors).toBe(true)
    expect(f.symbols.some((s) => s.name === 'good' && s.startLine === 1)).toBe(true)
  })

  it('empty source is ok with no symbols', async () => {
    const f = await symbolsOf('', 'e.ts')
    expect(f.symbols).toEqual([])
    expect(f.lineCount).toBe(0)
    expect(f.hasErrors).toBe(false)
  })

  it('CRLF line endings give the same lines and clean signatures', async () => {
    const f = await symbolsOf('function a() {}\r\nfunction b(x) {\r\n  return x\r\n}\r\n', 'a.js')
    expect(f.symbols.map(row)).toEqual([
      ['function', 'a', 1, 1, false],
      ['function', 'b', 2, 4, false],
    ])
    expect(f.symbols.every((s) => !s.signature.includes('\r'))).toBe(true)
  })

  it('never throws on garbage, lone surrogates or a huge single line', async () => {
    const { svc } = await boot()
    for (const src of ['\u0000\u0001\uFFFF{{{((( ]]]', '\uD800 function x() {}', 'a'.repeat(200_000), '`${'.repeat(500)]) {
      const r = await svc.parse(src, { filename: 'g.ts' })
      expect(typeof r.ok).toBe('boolean')
    }
  })

  it('a pathologically deep source ends in ok or parse_failed, never an exception', async () => {
    const { svc } = await boot()
    const src = 'namespace a{'.repeat(8000) + '}'.repeat(8000)
    const r = await svc.parse(src, { filename: 'deep.ts' })
    expect(r.ok || r.error.kind === 'parse_failed').toBe(true)
    // and the service is still usable afterwards
    const again = await svc.parse('function ok() {}', { filename: 'ok.ts' })
    expect(again.ok).toBe(true)
  })

  it('caps symbols and reports truncation', async () => {
    const src = Array.from({ length: 10 }, (_, i) => `function f${i}() {}`).join('\n')
    const f = await symbolsOf(src, 'many.ts', { maxSymbols: 4 })
    expect(f.symbols.map((s) => s.name)).toEqual(['f0', 'f1', 'f2', 'f3'])
    expect(f.truncated).toBe(true)
    expect((await symbolsOf(src, 'many.ts')).truncated).toBe(false)
  })
})

describe('errors and options', () => {
  const kind = (r: { ok: boolean; error?: { kind: string } }) => (r.ok ? 'ok' : r.error!.kind)

  it('unsupported file name / language / disallowed language', async () => {
    const { svc } = await boot()
    expect(kind(await svc.parse('x', { filename: 'notes.md' }))).toBe('unsupported_language')
    expect(kind(await svc.parse('x', {}))).toBe('unsupported_language')
    const { svc: onlyPy } = await boot({ languages: ['python'] })
    expect(kind(await onlyPy.parse('function a() {}', { filename: 'a.ts' }))).toBe('unsupported_language')
    expect(kind(await onlyPy.parse('def a(): pass', { filename: 'a.py' }))).toBe('ok')
  })

  it('explicit language wins over the file name', async () => {
    const { svc } = await boot()
    const r = await svc.parse('def a(): pass\n', { filename: 'weird.txt', language: 'python' })
    expect(r.ok && r.file.symbols.map((s) => s.name)).toEqual(['a'])
    const r2 = await svc.parse('def a(): pass\n', { filename: 'a.ts', language: 'python' })
    expect(r2.ok && r2.file.language).toBe('python')
  })

  it('too_large is refused before any grammar is loaded', async () => {
    const { svc } = await boot({ maxBytes: 10 })
    expect(kind(await svc.parse('function a() {}', { filename: 'a.ts' }))).toBe('too_large')
    expect(svc.loadedLanguages()).toEqual([])
    expect(kind(await svc.parse('a() {}', { filename: 'a.ts' }))).toBe('ok') // exactly at the limit is allowed (6 <= 10)
  })

  it('grammar_unavailable for a bad grammar dir, and a later call is not poisoned', async () => {
    const { svc } = await boot({ grammarDir: '/definitely/not/a/dir' })
    expect(kind(await svc.parse('function a() {}', { filename: 'a.ts' }))).toBe('grammar_unavailable')
    expect(kind(await svc.parse('function a() {}', { filename: 'a.ts' }))).toBe('grammar_unavailable')
  })

  it('rejects an unknown language in config', async () => {
    await expect(boot({ languages: ['cobol' as never] })).rejects.toBeInstanceOf(RetrievalTreesitterConfigError)
  })

  it('concurrent first calls share one grammar load', async () => {
    const { svc } = await boot()
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => svc.parse(`function f${i}() {}`, { filename: 'c.ts' })))
    expect(rs.every((r) => r.ok)).toBe(true)
    expect(svc.loadedLanguages()).toEqual(['typescript'])
  })

  it('loads each language lazily and only when used', async () => {
    const { svc } = await boot()
    expect(svc.loadedLanguages()).toEqual([])
    await svc.parse('x = 1', { filename: 'a.py' })
    expect(svc.loadedLanguages()).toEqual(['python'])
    await svc.parse('let x', { filename: 'a.js' })
    expect(svc.loadedLanguages()).toEqual(['javascript', 'python'])
  })

  it('disposing the plugin frees the parsers and further parses fail cleanly', async () => {
    const { svc, fiber } = await boot()
    await svc.parse('function a() {}', { filename: 'a.ts' })
    expect(svc.loadedLanguages()).toEqual(['typescript'])
    await fiber.dispose()
    expect(svc.loadedLanguages()).toEqual([])
    const r = await svc.parse('function a() {}', { filename: 'a.ts' })
    expect(r.ok ? 'ok' : r.error.kind).toBe('grammar_unavailable')
  })
})

describe('WASM memory is released', () => {
  afterEach(() => vi.restoreAllMocks())

  it('deletes every tree it creates, including for files with syntax errors and failures', async () => {
    const del = vi.spyOn(Tree.prototype, 'delete')
    const { svc } = await boot()
    await svc.parse('function a() {}', { filename: 'a.ts' })
    await svc.parse('function broken( {', { filename: 'b.ts' })
    await svc.parse('', { filename: 'c.ts' })
    expect(del).toHaveBeenCalledTimes(3)
  })

  it('deletes the tree even when extraction throws', async () => {
    const { svc } = await boot()
    await svc.parse('function warm() {}', { filename: 'w.ts' }) // load the grammar first
    const del = vi.spyOn(Tree.prototype, 'delete')
    vi.spyOn(Tree.prototype, 'rootNode', 'get').mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const r = await svc.parse('function a() {}', { filename: 'a.ts' })
    expect(r.ok ? 'ok' : r.error.kind).toBe('parse_failed')
    expect(del).toHaveBeenCalledTimes(1)
  })

  it('deletes each parser when the plugin is disposed', async () => {
    const del = vi.spyOn(Parser.prototype, 'delete')
    const { svc, fiber } = await boot()
    await svc.parse('function a() {}', { filename: 'a.ts' })
    await svc.parse('x = 1', { filename: 'a.py' })
    expect(del).not.toHaveBeenCalled()
    await fiber.dispose()
    expect(del).toHaveBeenCalledTimes(2)
  })

  it('a plugin disposed while a grammar is still loading does not leak the parser it creates', async () => {
    const del = vi.spyOn(Parser.prototype, 'delete')
    const { svc, fiber } = await boot()
    const pending = svc.parse('function a() {}', { filename: 'a.ts' }) // grammar load now in flight
    await fiber.dispose()
    const r = await pending
    expect(r.ok ? 'ok' : r.error.kind).toBe('grammar_unavailable')
    expect(svc.loadedLanguages()).toEqual([])
    expect(del).toHaveBeenCalledTimes(1)
  })

  it('a burst of concurrent first parses loads the grammar and creates the parser once', async () => {
    const load = vi.spyOn(Language, 'load')
    const { svc } = await boot()
    await Promise.all(Array.from({ length: 20 }, () => svc.parse('function a() {}', { filename: 'a.ts' })))
    expect(load).toHaveBeenCalledTimes(1)
  })
})
