// Child process used by the SQLite shared-state concurrency test.
import { SQLiteDatabase } from '../../src/util/sqlite.js'

const [path, countText] = process.argv.slice(2)
if (!path || !countText || !/^\d+$/.test(countText)) throw new Error('sqlite worker requires database path and operation count')
const count = Number(countText)
const db = new SQLiteDatabase(path)
for (let index = 0; index < count; index++) {
  await db.transaction((connection) => {
    connection.run('UPDATE counter SET value = value + 1 WHERE id = 1')
  })
}
