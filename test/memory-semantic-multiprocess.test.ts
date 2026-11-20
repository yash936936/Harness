import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SemanticFactStore } from '../src/bundles/memory/semantic-store.js'

const directories: string[] = []
const workerPath = join(__dirname, 'fixtures', 'semantic-store-worker.ts')

afterEach(async () => {
  while (directories.length) await rm(directories.pop()!, { recursive: true, force: true })
})

async function runWorker(directory: string, mode: 'put' | 'delete', workerId: string, count: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', workerPath, directory, mode, workerId, String(count)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`semantic worker ${workerId} exited ${code}: ${stderr.slice(0, 500)}`))
    })
  })
}

describe('semantic store cross-process scaling', () => {
  it('serializes concurrent writers, invalidates cross-process cursors, and rebuilds after deletion-heavy writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-semantic-multiprocess-'))
    directories.push(directory)

    await Promise.all(['writer-0', 'writer-1', 'writer-2', 'writer-3'].map((id) => runWorker(directory, 'put', id, 50)))

    const store = new SemanticFactStore(directory)
    const firstPage = await store.withLock(() => store.page(undefined, 20))
    expect(firstPage.items).toHaveLength(20)
    expect(await store.withLock(() => store.count())).toBe(200)

    await runWorker(directory, 'delete', 'deleter', 50)
    await expect(store.withLock(() => store.page(firstPage.items.at(-1)!.id, 20, firstPage.sourceBytes)))
      .rejects.toThrow(/cursor is stale because the source changed/)
    expect(await store.withLock(() => store.count())).toBe(150)

    await rm(join(directory, 'semantic.index.jsonl'), { force: true })
    await rm(join(directory, 'semantic.index.meta.json'), { force: true })
    const recovered = new SemanticFactStore(directory)
    expect(await recovered.withLock(() => recovered.count())).toBe(150)

    await recovered.withLock(() => recovered.put({
      tier: 'semantic',
      id: 'writer-0-0',
      text: 'reinserted semantic fact writer-0-0',
      why: 'Verify delete and reinsert ordering after index recovery.',
      ts: '2026-11-21T00:01:00.000Z',
    }, { maxFacts: 10_000, maxFactBytes: 8_192 }))

    const tail = await recovered.withLock(() => recovered.page('writer-3-49', 10))
    expect(tail.items.map((fact) => fact.id)).toContain('writer-0-0')
    expect(await recovered.withLock(() => recovered.count())).toBe(151)
  }, 120_000)
})
