/**
 * Boot-time policy enforcement self-test for profile-coding.
 * It verifies the live registry and policy hooks without executing a command or changing project files.
 */
import type { Context } from 'cordis'
import { CONFIDENCE_FIELD } from '../bundles/policy-gates/index.js'
import { COMMAND_TOOL } from '../bundles/tools-local/index.js'
import { ProfileError } from './errors.js'

/** The self-test runs under this session id, so it never lands in a real task's log. */
export const SELFTEST_SESSION = 'profile-coding-selftest'

/**
 * Prove the gates are enforcing in THIS context, not merely configured. Throws {@link ProfileError} if they are not. Exported so it can be
 * run (and tested) against any context. It makes one real call through the registry and asks the gate two questions about the real
 * `run_command`; nothing is executed or changed, and it logs only under {@link SELFTEST_SESSION}.
 *  1. The deny-list is live in the registry's `tools/pre-execute` path: a probe tool called with `rm -rf /` must be refused and must not run.
 *  2. `commandRisk` is wired: a shell command at confidence 1 must be held, and the signal must be present and score a read-only command 1.
 *     (A stricter signal of the owner's own is fine; a laxer one that lets the shell through is not.)
 */
export async function verifyGates(ctx: Context): Promise<void> {
  const fail = (why: string): never => {
    throw new ProfileError(`profile-coding: the policy gates are not enforcing (${why}). Refusing to run.`)
  }
  const c = ctx as Context & { policy?: Context['policy']; tools?: Context['tools'] }
  if (!c.tools) return fail('no tool registry')
  if (!c.policy) return fail('policy-gates is not loaded')

  let ran = false
  const probe = '__profile_selftest'
  const off = c.tools.register({
    name: probe,
    description: 'Boot self-test. Never offered to a model.',
    actionClass: 'real-fs-write',
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } } },
    execute: () => {
      ran = true
      return 'ran'
    },
  })
  try {
    const r = await c.tools.call(probe, { command: 'rm', args: ['-rf', '/'], [CONFIDENCE_FIELD]: 1 }, { sessionId: SELFTEST_SESSION })
    if (ran || r.ok) fail('a deny-listed call was not blocked')
  } finally {
    off()
  }

  const def = c.tools.list().find((t) => t.name === COMMAND_TOOL)
  if (!def) return fail(`${COMMAND_TOOL} is not registered, so command risk cannot be checked`)
  const ask = (args: string[], command: string) => c.policy!.evaluate({ sessionId: SELFTEST_SESSION, tool: def, input: { command, args, [CONFIDENCE_FIELD]: 1 } })
  if (ask(['-c', 'echo hi'], 'sh').verdict !== 'hold') fail('a shell command at confidence 1 was not held (is commandRisk wired?)')
  // Wired means PRESENT, not "lets it through": an owner's own stricter signal may legitimately hold a read-only command too.
  if (!ask(['--version'], 'node').signals?.some((x) => x.name === 'command-risk' && x.score === 1)) fail('the command-risk signal is not wired in')
}
