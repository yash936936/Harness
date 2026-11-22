import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = join(__dirname, '..', 'src')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    const stat = statSync(path)
    if (stat.isDirectory()) return sourceFiles(path)
    return /\.(?:[cm]?ts|tsx|js|mjs|cjs)$/.test(name) ? [path] : []
  })
}

describe('D-117 host process execution boundary', () => {
  it('keeps direct child_process imports inside the isolated subprocess service', () => {
    const imports = sourceFiles(sourceRoot).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      const hasProcessImport = /(?:from\s+|import\s*\(|require\s*\()\s*['"](?:node:)?child_process(?:\/[^'"]*)?['"]/.test(source)
      return hasProcessImport ? [relative(sourceRoot, path).replaceAll('\\\\', '/')] : []
    })

    expect(imports).toEqual(['bundles/subprocess/index.ts'])
  })

  it('keeps the generic host subprocess service isolated to the held Crabbox adapter', () => {
    const consumers = sourceFiles(sourceRoot).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      const importsSubprocess = /from\s+['"][^'"]*subprocess\/index\.js['"]/.test(source)
      return importsSubprocess && !path.endsWith('/bundles/subprocess/index.ts')
        ? [relative(sourceRoot, path).replaceAll('\\\\', '/')]
        : []
    })

    expect(consumers).toEqual(['bundles/sandbox-crabbox/index.ts'])
  })
})
