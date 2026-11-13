#!/usr/bin/env node
// Scan tracked text files. Print file:line and pattern name only, never the match.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const TEST_FIXTURES = new Map([
  ['test/credentials.test.ts', new Set(['sk-super-secret-value-should-not-appear-raw'])],
  ['test/memory-episodic.test.ts', new Set(['sk-legacy-episode-secret', 'sk-live-12345'])],
  ['test/openai-compatible.test.ts', new Set(['sk-or-v1-SECRETKEY1234567890', 'sk-FAKE-CUSTOMER-SECRET-999'])],
  ['test/provider-connection.test.ts', new Set(['sk-or-v1-SECRETKEY1234567890'])],
  ['test/session-log.test.ts', new Set(['sk-live-SEEDED-9f8e7d6c5b4a'])],
])
const PATTERNS = [
  ['openai-style key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['github token', /\b(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['private key block', /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/],
  ['aws access key', /\bAKIA[0-9A-Z]{16}\b/],
]
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
let bad = 0
for (const f of files) {
  let text
  try { text = fs.readFileSync(f, 'utf8') } catch { continue }
  if (text.includes('\u0000')) continue
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of PATTERNS) {
      const matches = line.matchAll(new RegExp(re.source, re.flags + 'g'))
      for (const match of matches) {
        if (TEST_FIXTURES.get(f)?.has(match[0])) continue
        console.error(`${f}:${i + 1}: ${name}`)
        bad++
      }
    }
  })
}
if (bad) { console.error(`secret scan: ${bad} finding(s)`); process.exit(1) }
console.log('secret scan ok')
