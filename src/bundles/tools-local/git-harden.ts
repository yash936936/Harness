/**
 * SEC-04: a git command being *read-only* does not make it *harmless*. Git reads the repository's own
 * configuration and attributes, and several of those settings name programs git will then run during
 * plain `status`, `diff`, `log` or `show`:
 *
 *   core.fsmonitor            run on every `git status` (and anything refreshing the index)
 *   filter.<driver>.clean     run by `status`/`diff` on any file `.gitattributes` assigns `filter=<driver>`
 *   diff.external / ext-diff  run by `diff`, `show`, `log -p`
 *   diff.<driver>.textconv    run by `diff`, `show`, `log -p` for files assigned `diff=<driver>`
 *   gpg.program               run by `log --show-signature` / `%G?`
 *
 * A hostile repository (a clone, an unpacked archive, or a branch an agent checked out) can set any of
 * these, so auto-approving `git status` as "score 1.0" would let a checkout execute code with no
 * approval. The classifier cannot see this; only the execution step can neutralise it. So every git
 * command classified read-only is run through `hardenGit`, which overrides those settings on the
 * command line (command-line `-c` outranks every config file and is inherited by git's own
 * subprocesses). Pager and optional-lock behavior are disabled with global Git flags because the sandbox API has no child-env override.
 *
 * Known residual: a submodule has its own config that git reads when it recurses. Recursion is switched
 * off (`diff.ignoreSubmodules=all`, `submodule.recurse=false`), which is the mitigation; it also means
 * submodule changes are not shown by these auto-approved commands (an approved command is not hardened
 * this way only if it is not one of the read-only subcommands).
 */

export const GIT_READ_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files'])
/** Subcommands that can invoke diff drivers. */
const DIFFING = new Set(['diff', 'log', 'show'])

export interface HardenedGit {
  /** Full argument list, with `-c` overrides in front and diff-driver switches after the subcommand. */
  args: string[]
}

/** Config keys a repository can use to make git run a program, as `filter.<driver>.<var>` keys. */
const FILTER_KEY = /^filter\.(.+)\.(clean|smudge|process|required)$/i

/**
 * Parse `git config --list -z [--show-scope]` output into the filter driver names that came from the
 * repository itself (scopes `local` and `worktree`, includes followed). Without scope information
 * (old git) EVERY driver is treated as repo-controlled: failing safe costs only some output fidelity.
 */
export function repoFilterDrivers(listZ: string, withScope: boolean): string[] {
  const names = new Set<string>()
  const tokens = listZ.split('\0')
  // `--list -z --show-scope` emits `scope NUL key NL value NUL`; without scope it is `key NL value NUL`.
  const step = withScope ? 2 : 1
  for (let i = 0; i + step - 1 < tokens.length; i += step) {
    const scope = withScope ? tokens[i]! : 'local'
    const entry = tokens[i + step - 1]!
    if (!entry) continue
    if (withScope && scope !== 'local' && scope !== 'worktree' && scope !== 'command') continue
    const nl = entry.indexOf('\n')
    const m = FILTER_KEY.exec(nl < 0 ? entry : entry.slice(0, nl))
    if (m) names.add(m[1]!)
  }
  return [...names]
}

/**
 * Build the hardened invocation. `filterDrivers` are the driver names the repository's own config
 * defines (see `repoFilterDrivers`). Returns `undefined` when `argv` is not a read-only git
 * subcommand, in which case the command is left exactly as given.
 */
export function hardenGit(argv: readonly string[], filterDrivers: readonly string[] = []): HardenedGit | undefined {
  const sub = argv[0]
  if (sub === undefined || !GIT_READ_SUBCOMMANDS.has(sub)) return undefined
  const overrides: string[] = [
    'core.fsmonitor=false',
    'credential.interactive=false',
    'core.pager=cat',
    'diff.external=',
    'diff.ignoreSubmodules=all',
    'submodule.recurse=false',
    'gpg.program=false',
    'gpg.ssh.program=false',
    'gpg.x509.program=false',
  ]
  for (const d of filterDrivers) {
    // An empty command means "no filter"; `required=false` stops git treating the missing filter as an error.
    overrides.push(`filter.${d}.clean=`, `filter.${d}.smudge=`, `filter.${d}.process=`, `filter.${d}.required=false`)
  }
  // These are global Git options and must precede the subcommand. The sandbox
  // API intentionally has no env override, so do not return environment settings
  // that the caller cannot apply.
  const pre = ['--no-pager', '--no-optional-locks', ...overrides.flatMap((o) => ['-c', o])]
  const post = DIFFING.has(sub) ? ['--no-ext-diff', '--no-textconv'] : []
  return { args: [...pre, sub, ...post, ...argv.slice(1)] }
}
