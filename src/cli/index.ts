#!/usr/bin/env node
import { TerminalIO } from './io.js'
import { runWizard } from './wizard.js'

async function main(): Promise<number> {
  const io = new TerminalIO()
  try {
    const result = await runWizard(io)
    return result.aborted ? 1 : 0
  } catch (e) {
    io.print(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  } finally {
    io.close()
  }
}

// `process.exitCode = ...` + letting the event loop drain naturally, not `process.exit()`: when
// stdout is piped rather than a real TTY, writes can be asynchronous, and `process.exit()` can
// terminate the process before they actually flush - found by hand running this for real (a
// scripted `WizardIO` in tests never touches real stdout, so nothing in the test suite could have
// caught this). `rl.close()` inside `io.close()` above is what lets the process exit on its own.
main().then((code) => {
  process.exitCode = code
})
