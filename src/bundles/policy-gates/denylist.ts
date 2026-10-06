import type { DenyRule } from './types.js'

/** Every string in a tool call's input, any depth. Capped so a hostile input cannot make matching expensive. */
export function collectStrings(input: unknown, maxStrings = 500, maxChars = 200_000): string[] {
  const out: string[] = []
  let chars = 0
  const walk = (v: unknown, depth: number) => {
    if (out.length >= maxStrings || chars >= maxChars || depth > 12) return
    if (typeof v === 'string') {
      out.push(v.slice(0, maxChars - chars))
      chars += v.length
    } else if (Array.isArray(v)) for (const x of v) walk(x, depth + 1)
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x, depth + 1)
  }
  walk(input, 0)
  return out
}

/**
 * Undo the cheap ways to hide a command from a pattern: case, quotes and backslashes inside a word (`r\m`, `'rm'`, `r""m`),
 * `${IFS}`, tabs and newlines. NOT undone: encoding (base64), variables, or a script that is written and then run.
 * Those are not caught here; a script written to disk is a gated write, and running it is a gated tool call.
 */
export function normalizeForMatch(s: string, backslashIsSeparator = false): string {
  return (backslashIsSeparator ? s.replace(/\\/g, '/') : s)
    .toLowerCase()
    .replace(/\$\{ifs\}|\$ifs/g, ' ')
    .replace(/\\\r?\n/g, ' ')
    .replace(/["'`\\]/g, (c) => (c === '`' ? ' ' : ''))
    .replace(/\$\(/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/ +/g, ' ')
    .trim()
}

/**
 * A backslash is an escape in a POSIX shell (`r\m` is `rm`) but a separator in a Windows path (`C:\tools\rm.exe`). We cannot know which
 * the caller meant, so every command rule is tried against BOTH readings.
 */
function norms(strings: string[]): string[] {
  const out = new Set<string>()
  for (const s of strings) {
    out.add(normalizeForMatch(s))
    out.add(normalizeForMatch(s, true))
  }
  return [...out]
}

/** For path matching: backslashes are Windows separators, so they become `/` BEFORE anything else (the command normaliser would delete them). */
export function normalizePath(s: string): string {
  return s.toLowerCase().replace(/\\/g, '/').replace(/["'`]/g, '').replace(/\/+/g, '/').trim()
}

/** Command segments (split on ; & | and newlines), each as tokens. Path prefixes and `.exe` are stripped from the command word only when asked. */
function segments(norm: string): string[][] {
  return norm.split(/[;&|]+/).map((seg) => seg.split(/[\s()<>]+/).filter(Boolean)).filter((t) => t.length)
}
const cmdName = (t: string) => t.split(/[\\/]/).pop()!.replace(/\.exe$/, '')
const isFlag = (t: string) => t.startsWith('-') && t.length > 1
const shortLetters = (toks: string[]) => toks.filter((t) => isFlag(t) && !t.startsWith('--')).flatMap((t) => [...t.slice(1)])
const hasLong = (toks: string[], ...names: string[]) => toks.some((t) => names.includes(t))

const rmRecursiveForce: DenyRule = {
  id: 'rm-recursive-force',
  description: 'rm with both recursive and force flags, in any order or spelling (-rf, -fr, -r -f, --recursive --force), including behind sudo/env/command/absolute paths/quotes',
  matches(strings) {
    for (const n of norms(strings)) for (const toks of segments(n)) {
      for (let i = 0; i < toks.length; i++) {
        if (cmdName(toks[i]!) !== 'rm') continue
        const rest = toks.slice(i + 1)
        const letters = shortLetters(rest)
        if ((letters.includes('r') || hasLong(rest, '--recursive')) && (letters.includes('f') || hasLong(rest, '--force'))) return `"${toks.slice(i, i + 4).join(' ')}"`
      }
    }
    return undefined
  },
}

const windowsRecursiveDelete: DenyRule = {
  id: 'windows-recursive-delete',
  description: 'Remove-Item -Recurse -Force, rd/rmdir /s /q, del/erase /s /q|/f',
  matches(strings) {
    for (const n of norms(strings)) for (const toks of segments(n)) {
      for (let i = 0; i < toks.length; i++) {
        const c = cmdName(toks[i]!)
        const rest = toks.slice(i + 1)
        if ((c === 'remove-item' || c === 'ri') && rest.some((t) => /^-r(e(c(u(r(s(e)?)?)?)?)?)?$/.test(t)) && rest.some((t) => /^-fo(r(c(e)?)?)?$/.test(t))) return `"${toks.slice(i, i + 4).join(' ')}"`
        if ((c === 'rd' || c === 'rmdir') && rest.includes('/s') && rest.includes('/q')) return `"${toks.slice(i, i + 4).join(' ')}"`
        if ((c === 'del' || c === 'erase') && rest.includes('/s') && (rest.includes('/q') || rest.includes('/f'))) return `"${toks.slice(i, i + 4).join(' ')}"`
      }
    }
    return undefined
  },
}

const findDelete: DenyRule = {
  id: 'find-delete',
  description: 'find ... -delete (a recursive delete by another name)',
  matches(strings) {
    for (const n of norms(strings)) for (const toks of segments(n)) {
      const i = toks.findIndex((t) => cmdName(t) === 'find')
      if (i >= 0 && toks.slice(i + 1).includes('-delete')) return `"${toks.slice(i, i + 5).join(' ')}"`
    }
    return undefined
  },
}

const codeRecursiveDelete: DenyRule = {
  id: 'code-recursive-delete',
  description: 'recursive delete written as code: shutil.rmtree, rimraf, fs.rm/rmdir({ recursive: true })',
  matches(strings) {
    for (const n of norms(strings)) {
      const m = /shutil\.rmtree|\brimraf\b|\brm(?:dir)?(?:sync)?\s*\([^)]*recursive\s*:\s*true/.exec(n)
      if (m) return `"${m[0].slice(0, 60)}"`
    }
    return undefined
  },
}

const gitForcePush: DenyRule = {
  id: 'git-force-push',
  description: 'git push with --force, -f (alone or combined, e.g. -fu), --force-with-lease, --mirror, or a +refspec',
  matches(strings) {
    for (const n of norms(strings)) for (const toks of segments(n)) {
      const g = toks.findIndex((t) => cmdName(t) === 'git')
      if (g < 0) continue
      const p = toks.indexOf('push', g + 1)
      if (p < 0) continue
      const rest = toks.slice(p + 1)
      const bad = rest.find((t) => t === '--force' || t === '--mirror' || t.startsWith('--force-with-lease') || (isFlag(t) && !t.startsWith('--') && t.includes('f')) || (t.startsWith('+') && t.length > 1))
      if (bad) return `"git push ... ${bad}"`
    }
    return undefined
  },
}

const CREDENTIAL_PATTERNS: [RegExp, string][] = [
  [/(^|\/)\.aws\/(credentials|config)\b/, 'AWS credentials file'],
  [/(^|\/)\.ssh\//, 'SSH directory'],
  [/\bid_(rsa|dsa|ecdsa|ed25519)\b(?!\.pub)/, 'SSH private key'],
  [/(^|\/)\.npmrc\b/, '.npmrc (registry tokens)'],
  [/(^|\/)\.netrc\b/, '.netrc'],
  [/(^|\/)\.pgpass\b/, '.pgpass'],
  [/(^|\/)\.git-credentials\b/, 'git credentials'],
  [/(^|\/)\.docker\/config\.json\b/, 'docker credentials'],
  [/(^|\/)\.kube\/config\b|\bkubeconfig\b/, 'kubeconfig'],
  [/\.(pem|p12|pfx|jks|keystore)\b/, 'key/certificate file'],
  [/(^|\/)credentials\.json\b/, 'credentials.json'],
  [/service[-_]account[^/ ]*\.json\b/, 'service account key'],
  [/application_default_credentials\.json\b/, 'gcloud credentials'],
  [/(^|\/)\.env\.(prod|production)\b/, 'production env file'],
  [/(^|\/)secrets?\.(ya?ml|json|toml)\b/, 'secrets file'],
  [/(^|\/)\.azure\//, 'Azure credentials directory'],
  [/(^|\/)\.config\/gh\/hosts\.ya?ml\b/, 'GitHub CLI token'],
  [/^\/etc\/shadow\b|\s\/etc\/shadow\b/, '/etc/shadow'],
]
const credentialPaths: DenyRule = {
  id: 'credential-path',
  description: 'any reference to a credential or key file (reading counts: the point is that the model never touches them)',
  matches(strings) {
    for (const s of strings) {
      const n = normalizePath(s)
      for (const [re, what] of CREDENTIAL_PATTERNS) {
        const m = re.exec(n)
        if (m) return `${what} ("${m[0].trim().slice(0, 50)}")`
      }
    }
    return undefined
  },
}

export const BUILTIN_DENY_RULES: readonly DenyRule[] = [rmRecursiveForce, windowsRecursiveDelete, findDelete, codeRecursiveDelete, gitForcePush, credentialPaths]
