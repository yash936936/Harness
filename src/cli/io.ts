import { createInterface, type Interface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

export interface AskOptions {
  /** Returned when the user presses enter with no input. */
  default?: string
  /** Printed as a one-line heads-up that this value isn't masked (1B.2, D-040 - see the note on `TerminalIO`). */
  secret?: boolean
}

export interface ConfirmOptions {
  /** `undefined` means there is no default - an empty answer is reprompted. */
  default?: boolean
}

/**
 * What `runWizard` (`wizard.ts`) needs from a terminal - kept this narrow
 * on purpose so tests can script a whole run (see `test/wizard.test.ts`)
 * against a fake that never touches a real TTY.
 */
export interface WizardIO {
  print(line: string): void
  ask(prompt: string, opts?: AskOptions): Promise<string>
  confirm(prompt: string, opts?: ConfirmOptions): Promise<boolean>
}

/**
 * Real terminal I/O via `node:readline/promises`.
 *
 * `secret: true` does **not** mask input (no asterisks, no hidden echo) -
 * it only adds a one-line warning before the prompt. A real masked-input
 * implementation needs raw-mode stdin, which (a) fights with readline's own
 * stdin listener on the same stream and (b) isn't exercisable by an
 * automated test at all (vitest has no real TTY) - shipping that untested,
 * for a path whose whole job is handling a secret correctly, was judged
 * worse than being honest that it doesn't mask yet. Documented as
 * deliberately not built (D-040) rather than a silently-broken feature.
 */
export class TerminalIO implements WizardIO {
  private readonly rl: Interface

  constructor() {
    this.rl = createInterface({ input: stdin, output: stdout })
  }

  print(line: string): void {
    stdout.write(`${line}\n`)
  }

  async ask(prompt: string, opts: AskOptions = {}): Promise<string> {
    if (opts.secret) this.print('(input is not masked - it will be visible on screen)')
    const suffix = opts.default !== undefined && opts.default !== '' ? ` [${opts.default}]` : ''
    const answer = (await this.rl.question(`${prompt}${suffix}: `)).trim()
    return answer === '' ? (opts.default ?? '') : answer
  }

  async confirm(prompt: string, opts: ConfirmOptions = {}): Promise<boolean> {
    const hint = opts.default === undefined ? 'y/n' : opts.default ? 'Y/n' : 'y/N'
    for (;;) {
      const raw = (await this.rl.question(`${prompt} [${hint}]: `)).trim().toLowerCase()
      if (raw === '' && opts.default !== undefined) return opts.default
      if (raw === 'y' || raw === 'yes') return true
      if (raw === 'n' || raw === 'no') return false
      this.print('Please answer y or n.')
    }
  }

  /** Releases the terminal so the process can exit. Not part of `WizardIO` - fakes in tests need no cleanup. */
  close(): void {
    this.rl.close()
  }
}
