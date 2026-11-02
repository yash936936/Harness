/** Raised when a profile refuses to boot, or boots and then finds a required service or guardrail is missing. */
export class ProfileError extends Error {
  override name = 'ProfileError'
}

/**
 * ARCH-04: Cordis does not throw when a plugin's constructor fails or one of its dependencies is absent: the
 * plugin is simply never started. So every profile declares the services it must end up with and checks them
 * by name after boot, returning the ones that are not live.
 */
export function missingFrom(ctx: unknown, required: readonly string[]): string[] {
  const live = ctx as Record<string, unknown>
  return required.filter((k) => !live[k])
}
