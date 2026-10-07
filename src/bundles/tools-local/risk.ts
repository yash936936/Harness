import type { Signal } from '../policy-gates/types.js'

/**
 * An INDEPENDENT risk signal for `run_command` (Phase 5.4): scored from the command itself, never from what
 * the model says about it. The path and diff-size signals cannot judge a command, so without this signal a
 * command call has no independent signal and the gate HOLDS it (fail closed). With it:
 *   1.0  known read-only invocations (git status/diff/log/show/rev-parse/ls-files, ls, pwd, node --version)
 *   0.7  runs project code (npm test, npm run <script>): not read-only, held at the default 0.8 threshold
 *   0.2  anything else, including a command given as a path, an absolute or `..` argument to a "safe" command
 *   0.0  shells and interpreters, which can run anything (`sh -c`, `node -e`, `python`, `powershell`, `cmd`)
 * The default threshold is 0.8, so only the 1.0 class runs without approval. This is a table, not an analysis
 * of what a command will do: it does not look inside `npm test`, and a package.json script the agent edited
 * earlier runs as written. That edit is its own gated write (package.json scores 0.5).
 */
export const COMMAND_TOOL = 'run_command'

const INTERPRETERS = new Set([
  'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'cmd', 'powershell', 'pwsh', 'wsl',
  'node', 'nodejs', 'python', 'python2', 'python3', 'py', 'perl', 'ruby', 'php', 'lua', 'deno', 'bun',
  'env', 'xargs', 'sudo', 'su', 'doas', 'eval', 'exec', 'nohup', 'time', 'timeout', 'watch', 'nice', 'command', 'busybox',
  'npx', 'pnpx', 'bunx', 'yarn', 'pnpm', 'pip', 'pip3', 'curl', 'wget', 'ssh', 'scp', 'nc', 'ncat', 'telnet',
])
const GIT_READ = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files'])
const GIT_DANGEROUS_ARG = /^--(output|ext-diff|textconv|exec-path|upload-pack|receive-pack|open-files-in-pager|paginate)(=|$)/

function bare(command: string): string {
  return command.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '')
}

const escapesProject = (a: string) => a.startsWith('/') || a.startsWith('\\') || a.startsWith('~') || /^[a-z]:/i.test(a) || a.split(/[\\/]/).includes('..')

export const commandRisk: Signal = (ev) => {
  if (ev.tool.name !== COMMAND_TOOL) return undefined
  const input = (ev.input ?? {}) as { command?: unknown; args?: unknown }
  const sig = (score: number, note: string) => ({ name: 'command-risk', score, note })
  if (typeof input.command !== 'string' || !input.command.trim()) return sig(0, 'no command')
  const args = Array.isArray(input.args) ? input.args : []
  if (!args.every((a) => typeof a === 'string')) return sig(0, 'non-string argument')
  const argv = args as string[]
  const cmd = input.command.trim()

  // A command given as a path can be a file the agent wrote, whatever its name says.
  if (/[\\/]/.test(cmd)) return sig(0.2, `"${cmd}" is given as a path, not a bare command name`)
  const name = bare(cmd)
  if (INTERPRETERS.has(name) && !(name === 'node' && argv.length === 1 && argv[0] === '--version')) return sig(0, `"${name}" can run arbitrary code or fetch and run packages`)

  if (name === 'node') return sig(1, 'node --version')
  if (name === 'pwd' && argv.length === 0) return sig(1, 'pwd')
  if (name === 'git') {
    const sub = argv[0]
    if (sub === undefined || !GIT_READ.has(sub)) return sig(0.2, `git ${sub ?? ''}: not a known read-only git command`.trim())
    if (argv.some((a) => GIT_DANGEROUS_ARG.test(a) || escapesProject(a))) return sig(0.2, `git ${sub}: option or path that can write or leave the project`)
    return sig(1, `git ${sub} (read-only)`)
  }
  if (name === 'ls') {
    if (argv.some(escapesProject)) return sig(0.2, 'ls: path outside the project')
    return sig(1, 'ls (read-only)')
  }
  if (name === 'npm') {
    const sub = argv[0]
    if (sub === 'test' || sub === 'run' || sub === 'run-script') return sig(0.7, `npm ${sub}: runs project scripts`)
    return sig(0.2, `npm ${sub ?? ''}: not a known invocation`.trim())
  }
  return sig(0.2, `"${name}" is not a command this table knows`)
}
