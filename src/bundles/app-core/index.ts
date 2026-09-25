import { Context, Service } from 'cordis'
import { Budgets, type BudgetsConfig } from './budgets.js'
import {
  AutoCredentialStore,
  FileCredentialStore,
  KeychainCredentialStore,
  type CredentialStore,
  type FileCredentialStoreConfig,
} from './credentials.js'

export * from './budgets.js'
export * from './credentials.js'

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
 * `budgets` and `credentials` are done. Consent-screen data and `doctor`
 * are separate, later slices of the same bundle.
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
}

export const name = 'bundle-app-core'
export function apply(ctx: Context, config: AppCoreConfig) {
  ctx.plugin(AppCore, config)
}
