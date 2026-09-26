import type { EgressStatus } from '../egress/types.js'
import type { BudgetStatus, Budgets } from './budgets.js'
import { describeCredentialStore, type CredentialStore } from './credentials.js'

export type { EgressStatus }

/** Anything that can report its own current egress status - `EgressPolicy` satisfies this; a fake is enough for tests. */
export interface EgressStatusSource {
  status(): Promise<EgressStatus>
}

export interface DoctorReport {
  budgets: BudgetStatus
  /** `undefined` when no daily hard request limit is configured - there is no ceiling to count down from (mirrors `Budgets.requestsLeftToday`). */
  requestsLeftToday?: number
  credentials: { active: 'keychain' | 'file' | 'unresolved' }
  egress: EgressStatus
}

/**
 * Read-only status across everything built so far (1B.2, D-039): budgets
 * remaining, which credential store is actually active, consent state, and
 * the egress allowlist. Nothing here mutates state - no probe is written,
 * no consent is granted or revoked, no budget is spent.
 *
 * Scoped to what exists: the design draft's fuller `doctor` (active
 * binding, remote-sandbox destinations, pinned-model availability, what
 * still works offline) waits on 1B.3 (model-store/pinning) and Phase 5
 * (sandbox providers), neither of which is built yet - reporting on them
 * now would mean inventing data. This is the same "don't fabricate an
 * answer you don't have a real source for" stance `consent-copy.ts`
 * already takes for a provider's data-policy claim.
 */
export async function buildDoctorReport(budgets: Budgets, credentials: CredentialStore, egress: EgressStatusSource): Promise<DoctorReport> {
  return {
    budgets: budgets.status(),
    requestsLeftToday: budgets.requestsLeftToday(),
    credentials: { active: await describeCredentialStore(credentials) },
    egress: await egress.status(),
  }
}
