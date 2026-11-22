import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SemanticFactStore } from '../src/bundles/memory/semantic-store.js'

const directories: string[] = []
const workerPath = join(__dirname, 'fixtures', 'semantic-store-worker.ts')

afterEach(async () => {
  while (directories.length) await rm(directories.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function runWorker(
  directory: string,
  mode: 'put' | 'delete',
  workerId: string,
  count: number,
  targetWorkerId?: string,
): Promise<void> {
  const args = ['--import', 'tsx', workerPath, directory, mode, workerId, String(count)]
  if (targetWorkerId) args.push(targetWorkerId)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`semantic worker ${workerId} exited ${code}: ${stderr.slice(0, 500)}`))
    })
  })
}

describe('semantic store concurrent scale stress', () => {
  it('preserves exact counts across concurrent writers and deletion workers, invalidates cursors, and rebuilds the index', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-semantic-concurrency-stress-'))
    directories.push(directory)

    // Eight independent processes establish a 1,000-record starting store.
    await Promise.all(Array.from({ length: 8 }, (_, index) =>
      runWorker(directory, 'put', `writer-${index}`, 125),
    ))

    const store = new SemanticFactStore(directory)
    const firstPage = await store.withLock(() => store.page(undefined, 25))
    expect(firstPage.items).toHaveLength(25)
    expect(await store.withLock(() => store.count())).toBe(1_000)

    // Four writers add 400 records while four independent deleters remove
    // 400 existing records. The expected live count remains exactly 1,000.
    await Promise.all([
      ...Array.from({ length: 4 }, (_, index) =>
        runWorker(directory, 'put', `extra-${index}`, 100),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        runWorker(directory, 'delete', `deleter-${index}`, 100, `writer-${index}`),
      ),
    ])

    await expect(store.withLock(() =>
      store.page(firstPage.items.at(-1)!.id, 25, firstPage.sourceBytes),
    )).rejects.toThrow(/cursor is stale because the source changed/)
    expect(await store.withLock(() => store.count())).toBe(1_000)

    // Remove both derived files to force a full authoritative-log rebuild.
    await rm(join(directory, 'semantic.index.jsonl'), { force: true })
    await rm(join(directory, 'semantic.index.meta.json'), { force: true })
    const recovered = new SemanticFactStore(directory)
    const recoveredCount = await recovered.withLock(() => recovered.count())
    expect(recoveredCount).toBe(1_000)

    const page = await recovered.withLock(() => recovered.page(undefined, 2_000))
    expect(page.items).toHaveLength(1_000)
    expect(new Set(page.items.map((entry) => entry.id)).size).toBe(1_000)
    expect(page.items.some((entry) => entry.id === 'writer-0-0')).toBe(false)
    expect(page.items.some((entry) => entry.id === 'extra-0-0')).toBe(true)
  }, 180_000)
})
