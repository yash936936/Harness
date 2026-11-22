import { SemanticFactStore } from '../../src/bundles/memory/semantic-store.js'

const [directory, mode, workerId, countValue, targetWorkerId = 'writer-0'] = process.argv.slice(2)
if (!directory || !mode || !workerId || !countValue) {
  throw new Error('expected directory, mode, worker id, count, and optional delete target')
}
const count = Number(countValue)
if (!Number.isSafeInteger(count) || count < 1) throw new Error('count must be a positive integer')

const store = new SemanticFactStore(directory)
if (mode === 'put') {
  for (let index = 0; index < count; index++) {
    const id = `${workerId}-${index}`
    await store.withLock(() => store.put({
      tier: 'semantic',
      id,
      text: `semantic fact ${id}`,
      why: 'Cross-process semantic-store stress fixture.',
      ts: '2026-11-21T00:00:00.000Z',
    }, { maxFacts: 10_000, maxFactBytes: 8_192 }))
  }
} else if (mode === 'delete') {
  for (let index = 0; index < count; index++) {
    await store.withLock(() => store.delete(`${targetWorkerId}-${index}`))
  }
} else {
  throw new Error(`unsupported semantic worker mode: ${mode}`)
}
