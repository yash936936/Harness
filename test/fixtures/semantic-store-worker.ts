import { SemanticFactStore } from '../../src/bundles/memory/semantic-store.js'

const [directory, mode, workerId, countValue, targetWorkerId = 'writer-0'] = process.argv.slice(2)
if (!directory || !mode || !workerId || !countValue) {
  throw new Error('expected directory, mode, worker id, count, and optional delete target')
}
const count = Number(countValue)
if (!Number.isSafeInteger(count) || count < 1) throw new Error('count must be a positive integer')

// Windows CI runners can be heavily contended by the full cross-process test matrix.
const store = new SemanticFactStore(directory, 30_000)
const batchSize = 25
if (mode === 'put') {
  for (let start = 0; start < count; start += batchSize) {
    await store.withLock(async () => {
      for (let index = start; index < Math.min(start + batchSize, count); index++) {
        const id = `${workerId}-${index}`
        await store.put({
          tier: 'semantic',
          id,
          text: `semantic fact ${id}`,
          why: 'Cross-process semantic-store stress fixture.',
          ts: '2026-11-21T00:00:00.000Z',
        }, { maxFacts: 10_000, maxFactBytes: 8_192 })
      }
    })
  }
} else if (mode === 'delete') {
  for (let start = 0; start < count; start += batchSize) {
    await store.withLock(async () => {
      for (let index = start; index < Math.min(start + batchSize, count); index++) {
        await store.delete(`${targetWorkerId}-${index}`)
      }
    })
  }
} else {
  throw new Error(`unsupported semantic worker mode: ${mode}`)
}
