/**
 * Boot-time policy enforcement self-test for profile-coding.
 * It verifies the live registry and policy hooks without executing a command or changing project files.
 */
import type { Context } from 'cordis'
import { ProfileError } from './errors.js'

/** The self-test runs under this session id, so it never lands in a real task's log. */
export const SELFTEST_SESSION = 'profile-coding-selftest'

/**
 * Prove the gates are enforcing in THIS context, not merely configured. Throws {@link ProfileError} if they are not. Exported so it can be
 * run (and tested) against any context. It makes one real call through the registry; nothing is executed or changed, and it logs only under
 * {@link SELFTEST_SESSION}. The coding profile must not register `run_command` until D-118 workspace transfer, result sync, lifecycle, and policy
 * acceptance are complete. The self-test therefore proves the deny hook is live and the command capability is absent.
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

  if (c.tools.list().some((t) => t.name === 'run_command')) fail('run_command is registered before D-118 acceptance')
}
