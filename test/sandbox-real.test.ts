import { describe, it } from 'vitest'

// D-110: this acceptance path is permanently held. Keep the test name visible,
// but never let an environment variable reactivate host Docker/WSL/Crabbox probes.
describe.skip('real Crabbox sandbox acceptance (permanent hold D-110)', () => {
  it('is intentionally not runnable', () => {})
})
