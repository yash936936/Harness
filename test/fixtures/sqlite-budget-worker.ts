// Independent process used to verify shared SQLite budget reservations.
import { SQLiteBudgetReservationStore } from '../../src/bundles/app-core/budgets.js'

const [path, idempotencyKey, expiresAt] = process.argv.slice(2)
if (!path || !idempotencyKey || !expiresAt) throw new Error('budget worker requires database path, idempotency key, and expiry')
const store = new SQLiteBudgetReservationStore(path)
const result = await store.reserve({
  projectId: 'project-test',
  subjectId: 'day:2026-11-16',
  metric: 'requests',
  amount: 1,
  hardLimit: 1,
  idempotencyKey,
  expiresAt,
})
process.stdout.write(JSON.stringify(result))
