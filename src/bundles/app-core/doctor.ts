import type { EgressStatus } from '../egress/types.js'
import type { ModelAvailability } from '../model-store/types.js'
import type { BudgetStatus, Budgets } from './budgets.js'
import { describeCredentialStore, type CredentialStore } from './credentials.js'

export type { EgressStatus }

/** Anything that can report its own current egress status - `EgressPolicy` satisfies this; a fake is enough for tests. */
export interface EgressStatusSource {
  status(): Promise<EgressStatus>
}

/** Anything that can report every binding's pin/fallback availability - `ModelStore` satisfies this; a fake is enough for tests. */
export interface ModelStoreSource {
  resolveAll(): ModelAvailability[]
}

export interface DoctorReport {
  budgets: BudgetStatus
  /** `undefined` when no daily hard request limit is configured - there is no ceiling to count down from (mirrors `Budgets.requestsLeftToday`). */
  requestsLeftToday?: number
  credentials: { active: 'keychain' | 'file' | 'unresolved' }
  egress: EgressStatus
  /** Present only when a `ModelStoreSource` is passed to `buildDoctorReport` - absent, not an empty array, when there's nothing to report a model store against yet (1B.3 isn't wired into the wizard). */
  models?: ModelAvailability[]
}

/**
 * Read-only status across everything built so far (1B.2 + 1B.3, D-039,
 * D-041): budgets remaining, which credential store is actually active,
 * consent state, the egress allowlist, and now (when a model store is
 * passed in) which pinned bindings actually resolve. Nothing here mutates
 * state - no probe is written, no consent is granted or revoked, no budget
 * is spent, no model is registered.
 *
 * Still scoped to what exists: the design draft's fuller `doctor` also
 * wants remote-sandbox destinations and "what still works offline", which
 * wait on Phase 5 (sandbox providers) - reporting on those now would mean
 * inventing data, the same stance `consent-copy.ts` already takes for a
 * provider's data-policy claim.
 */
export async function buildDoctorReport(
  budgets: Budgets,
  credentials: CredentialStore,
  egress: EgressStatusSource,
  models?: ModelStoreSource,
): Promise<DoctorReport> {
  return {
    budgets: budgets.status(),
    requestsLeftToday: budgets.requestsLeftToday(),
    credentials: { active: await describeCredentialStore(credentials) },
    egress: await egress.status(),
    ...(models ? { models: models.resolveAll() } : {}),
  }
}
