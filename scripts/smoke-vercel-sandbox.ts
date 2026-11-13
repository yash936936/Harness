import { Context } from 'cordis'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { Sandbox } from '../src/bundles/sandbox/index.js'
import { VercelSandboxProvider } from '../src/bundles/sandbox-vercel/index.js'

async function main(): Promise<void> {
  if (process.env.HARNESS_VERCEL_SANDBOX_LIVE !== '1') {
    throw new Error('Refusing live cloud access. Set HARNESS_VERCEL_SANDBOX_LIVE=1 to explicitly authorize this one-command smoke test.')
  }
  const missing = ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'].filter((key) => !process.env[key])
  if (missing.length) throw new Error(`Missing required host environment variables: ${missing.join(', ')}`)

  const ctx = new Context()
  await ctx.plugin(EgressPolicy, {
    projectId: 'harness-vercel-sandbox-smoke',
    allowedHosts: ['vercel.com'],
  })
  await ctx.egress.grantConsent()
  await ctx.plugin(Sandbox)
  ctx.sandbox.register(new VercelSandboxProvider())

  const result = await ctx.sandbox.run({ command: ['true'], timeoutMs: 30_000 })
  if (result.exitCode !== 0 || !result.released || result.timedOut) {
    throw new Error(`Vercel smoke failed: exitCode=${result.exitCode}, timedOut=${result.timedOut}, released=${result.released}, releaseNote=${result.releaseNote ?? 'none'}`)
  }
  process.stdout.write(`VERCEL_SANDBOX_SMOKE_OK provider=${result.provider} lease=${result.leaseId} released=${result.released} durationMs=${result.durationMs}\n`)
}

main().catch((error) => {
  process.stderr.write(`VERCEL_SANDBOX_SMOKE_FAILED: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
