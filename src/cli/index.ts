#!/usr/bin/env node
import { TerminalIO } from './io.js'
import { parseArgs } from 'node:util'
import { basename } from 'node:path'
import { runTask } from './run.js'
import { runWizard } from './wizard.js'

async function main(): Promise<number> {
  const io = new TerminalIO()
  try {
    if (process.argv[2] === 'run') {
      const { values, positionals } = parseArgs({
        args: process.argv.slice(3),
        allowPositionals: true,
        options: {
          provider: { type: 'string', default: 'ollama' },
          model: { type: 'string' },
          'base-url': { type: 'string' },
          name: { type: 'string' },
          project: { type: 'string', default: basename(process.cwd()) },
          'daily-limit': { type: 'string' },
        },
      })
      const prompt = positionals.join(' ')
      if (!values.model || !prompt || (values.provider !== 'ollama' && values.provider !== 'openai-compatible')) {
        io.print('usage: npm run harness -- run --model <tag> [--provider ollama|openai-compatible] [--base-url URL] [--name NAME] [--project ID] [--daily-limit N] "<prompt>"')
        return 2
      }
      const dailyLimit = values['daily-limit'] !== undefined ? Number(values['daily-limit']) : undefined
      if (dailyLimit !== undefined && (!Number.isFinite(dailyLimit) || dailyLimit <= 0)) {
        io.print('--daily-limit must be a positive number')
        return 2
      }
      const r = await runTask(io, { prompt, projectId: values.project!, kind: values.provider, model: values.model, baseUrl: values['base-url'], name: values.name, dailyLimit })
      return r.ok ? 0 : 1
    }
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
