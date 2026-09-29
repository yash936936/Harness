import { parseArgs } from 'node:util'
import { sha256File } from '../src/bundles/model-store/index.js'

/**
 * Turns a real downloaded model file into a ready-to-paste `ModelRecord` (D-046). It hashes the
 * file you point it at - nothing is fetched, nothing is registered, and every other field is
 * exactly what you type, so the digest is the only thing this computes.
 */
const { values } = parseArgs({
  options: {
    id: { type: 'string' },
    source: { type: 'string' },
    revision: { type: 'string' },
    license: { type: 'string' },
    file: { type: 'string' },
    notes: { type: 'string' },
  },
})
const missing = ['id', 'source', 'revision', 'license', 'file'].filter((k) => !(values as Record<string, unknown>)[k])
if (missing.length) {
  console.error(`missing: ${missing.map((m) => `--${m}`).join(' ')}\nusage: npm run pin -- --id needle2 --source cactus-compute --revision <hf commit or tag> --license "Apache-2.0" --file <path>`)
  process.exit(2)
}
const sha256 = await sha256File(values.file!)
console.log(`// sha256 computed from ${values.file}\n${JSON.stringify({ id: values.id, source: values.source, revision: values.revision, sha256, license: values.license, ...(values.notes ? { notes: values.notes } : {}) }, null, 2)}`)
