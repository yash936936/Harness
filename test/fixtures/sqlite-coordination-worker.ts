import { SQLiteRateLimitStore, SQLiteLeaseStore } from '../../src/bundles/app-core/budgets.js'

const [mode, path, key] = process.argv.slice(2)
if (!mode || !path || !key) throw new Error('expected mode, database path, and key')

if (mode === 'rate') {
  const store = new SQLiteRateLimitStore(path)
  const result = await store.acquire({
    projectId: 'project-process-test',
    principalId: 'provider-account',
    bucket: 'completion',
    idempotencyKey: key,
    limit: 1,
    windowMs: 60_000,
    maxConcurrent: 8,
    permitTtlMs: 30_000,
  })
  process.stdout.write(JSON.stringify(result))
} else if (mode === 'lease') {
  const store = new SQLiteLeaseStore(path)
  const result = await store.acquire({
    projectId: 'project-process-test',
    resourceType: 'workspace',
    resourceId: 'shared-task',
    ownerId: key,
    idempotencyKey: `acquire:${key}`,
    ttlMs: 30_000,
  })
  process.stdout.write(JSON.stringify(result))
} else {
  throw new Error(`unsupported worker mode: ${mode}`)
}
