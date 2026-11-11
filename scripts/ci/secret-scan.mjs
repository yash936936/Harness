#!/usr/bin/env node
// Scan tracked text files. Print file:line and pattern name only, never the match.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const ALLOW = [/^test\//]
const PATTERNS = [
  ['openai-style key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['github token', /\b(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['private key block', /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/],
  ['aws access key', /\bAKIA[0-9A-Z]{16}\b/],
]
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
let bad = 0
for (const f of files) {
  if (ALLOW.some((re) => re.test(f))) continue
  let text
  try { text = fs.readFileSync(f, 'utf8') } catch { continue }
  if (text.includes('\u0000')) continue
  text.split('\n').forEach((line, i) => { for (const [name, re] of PATTERNS) if (re.test(line)) { console.error(`${f}:${i + 1}: ${name}`); bad++ } })
}
if (bad) { console.error(`secret scan: ${bad} finding(s)`); process.exit(1) }
console.log('secret scan ok')
