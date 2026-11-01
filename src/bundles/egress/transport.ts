/**
 * Transport rules shared by every provider that can reach a non-loopback host (SEC-02).
 *
 * 1. Redirects are never followed. The allowlist check in `ctx.egress` looks at the host the
 *    provider was *configured* with; Node's fetch would otherwise follow a 307/308 to any other
 *    host and replay the request body (the prompt, plus the Authorization header on same-origin
 *    hops) there. A redirect is therefore treated as an error, not a hop.
 * 2. A remote endpoint must use https unless the binding opted in to plaintext explicitly, since
 *    bearer keys and prompts would otherwise cross the network in the clear.
 */

/** `fetch` init fragment: hand 3xx responses back instead of following them. */
export const NO_REDIRECT = { redirect: 'manual' } as const

/** True for any 3xx answer (a manual-redirect fetch returns the real status in Node). */
export function isRedirect(res: { status: number; type?: string }): boolean {
  return (res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect'
}

/** Message safe to log: the Location target's host only, never its path or query. */
export function redirectMessage(provider: string, res: { status: number; headers: { get(n: string): string | null } }): string {
  let where = 'another location'
  const loc = res.headers.get('location')
  if (loc) {
    try {
      where = new URL(loc, 'http://placeholder.invalid').host
      if (where === 'placeholder.invalid') where = 'a relative path'
    } catch {
      /* keep the generic text */
    }
  }
  return `${provider}: refused to follow a redirect (HTTP ${res.status}) to ${where}. Redirects are never followed because the egress allowlist only covers the configured host; point the base URL at the final address instead.`
}

/** Returns an error message when `baseUrl` is a remote plaintext endpoint without opt-in, else undefined. */
export function insecureTransportProblem(provider: string, baseUrl: string, remote: boolean, allowInsecureHttp: boolean | undefined): string | undefined {
  if (!remote || allowInsecureHttp) return undefined
  let protocol: string
  try {
    protocol = new URL(baseUrl).protocol
  } catch {
    return undefined
  }
  if (protocol === 'https:') return undefined
  return `${provider}: refusing to use plaintext ${protocol.replace(':', '')} for the remote host ${new URL(baseUrl).host}. Use an https:// base URL, or set \`allowInsecureHttp: true\` for a trusted private network.`
}
