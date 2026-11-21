import { open } from 'node:fs/promises'
import { join } from 'node:path'

const [dir] = process.argv.slice(2)
if (!dir) throw new Error('expected semantic store directory')

const file = join(dir, 'semantic.events.jsonl')
const handle = await open(file, 'a')
await handle.write('{"op":"put","fact":')
await handle.sync()
// Model process death after only a prefix of a semantic event reached the source log.
process.exit(23)
