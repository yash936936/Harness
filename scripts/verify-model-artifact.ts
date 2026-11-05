/** Verify a locally downloaded model artifact against an independently supplied SHA-256. */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
const [file, expectedFile] = process.argv.slice(2)
if (!file || !expectedFile || !existsSync(file) || !existsSync(expectedFile)) {
  console.error('usage: npx tsx scripts/verify-model-artifact.ts <artifact-file> <provenance.json>')
  process.exit(2)
}
const provenance = JSON.parse(readFileSync(expectedFile, 'utf8')) as { model: string; revision: string; sha256: string; source: string }
if (!provenance.model || !provenance.revision || !provenance.source || !/^[a-f0-9]{64}$/i.test(provenance.sha256 ?? '')) {
  console.error('provenance must contain model, immutable revision, source, and 64-character SHA-256')
  process.exit(2)
}
const hash = createHash('sha256')
for await (const chunk of createReadStream(file)) hash.update(chunk)
const actual = hash.digest('hex')
const ok = actual.toLowerCase() === provenance.sha256.toLowerCase()
console.log(JSON.stringify({ ok, file: basename(file), model: provenance.model, revision: provenance.revision, source: provenance.source, expectedSha256: provenance.sha256, actualSha256: actual }, null, 2))
if (!ok) process.exit(1)
