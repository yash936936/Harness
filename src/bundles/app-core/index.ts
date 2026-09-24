import { Context, Service } from 'cordis'
import { Budgets, type BudgetsConfig } from './budgets.js'

export * from './budgets.js'

export interface AppCoreConfig {
  budgets?: BudgetsConfig
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
 * `budgets` is the first piece. Credential storage, consent-screen data,
 * and `doctor` are separate, later slices of the same bundle.
 */
export class AppCore extends Service {
  readonly budgets: Budgets

  constructor(ctx: Context, config: AppCoreConfig = {}) {
    super(ctx, 'appCore')
    this.budgets = new Budgets(config.budgets)
  }
}

export const name = 'bundle-app-core'
export function apply(ctx: Context, config: AppCoreConfig) {
  ctx.plugin(AppCore, config)
}
