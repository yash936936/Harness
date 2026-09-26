import { Context, Service } from 'cordis'
import { Budgets, type BudgetsConfig } from './budgets.js'
import {
  AutoCredentialStore,
  FileCredentialStore,
  KeychainCredentialStore,
  type CredentialStore,
  type FileCredentialStoreConfig,
} from './credentials.js'
import { buildConsentScreenData, type ConsentScreenData } from './consent-copy.js'
import { testProviderConnection, type ProviderConnectionResult, type TestConnectionOptions } from './provider-connection.js'
import type { LLMProvider } from '../model-adapter/types.js'

export * from './budgets.js'
export * from './credentials.js'
export * from './consent-copy.js'
export * from './provider-connection.js'

export interface AppCoreConfig {
  budgets?: BudgetsConfig
  credentials?: {
    /** Keychain service name. Default: `'harness'`. */
    service?: string
    /** Encrypted-file fallback config. Default path: `<cwd>/.harness/credentials.json`. */
    file?: FileCredentialStoreConfig
    /**
     * Inject a store directly (tests, or a caller that already resolved
     * one) - bypasses keychain-vs-file selection entirely when set.
     */
    store?: CredentialStore
  }
}

declare module 'cordis' {
  interface Context {
    appCore: AppCore
  }
}

/**
 * `ctx.appCore` - 1B.2's headless first-run/ongoing logic (D-025): the
 * terminal wizard, and later the desktop shell (1B.4), are thin clients
 * over this, so the two surfaces cannot disagree with each other.
 *
 * Built incrementally, one piece of 1B.2 at a time (see `docs/phases.md`
 * 1B.2, `docs/status.md` for exactly what's landed vs. still open):
 * `budgets`, `credentials`, consent-screen data and the provider connection
 * test are done. `doctor` and the terminal wizard client are later slices of
 * the same phase.
 */
export class AppCore extends Service {
  readonly budgets: Budgets
  readonly credentials: CredentialStore

  constructor(ctx: Context, config: AppCoreConfig = {}) {
    super(ctx, 'appCore')
    this.budgets = new Budgets(config.budgets)
    this.credentials =
      config.credentials?.store ??
      new AutoCredentialStore(
        new KeychainCredentialStore(config.credentials?.service ?? 'harness'),
        new FileCredentialStore(config.credentials?.file ?? { path: '.harness/credentials.json' }),
      )
  }

  /** What the first-run/consent screen should show for one configured provider binding (D-020). */
  consentScreen(providerName: string, egress?: { host: string; remote: boolean }): ConsentScreenData {
    return buildConsentScreenData(providerName, egress)
  }

  /**
   * Connection test for a provider being set up (1B.2): list models
   * (best-effort), one tiny call, latency. Takes an already-constructed
   * provider - see `testProviderConnection` for why this isn't looked up on
   * `ctx.llm` by name.
   */
  testConnection(provider: LLMProvider, opts?: TestConnectionOptions): Promise<ProviderConnectionResult> {
    return testProviderConnection(provider, opts)
  }
}

export const name = 'bundle-app-core'
export function apply(ctx: Context, config: AppCoreConfig) {
  ctx.plugin(AppCore, config)
}
