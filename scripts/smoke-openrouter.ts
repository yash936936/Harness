/** Explicit live OpenRouter smoke test. Requires HARNESS_LIVE_OPENROUTER=1 and OPENROUTER_API_KEY. */
import { Context } from 'cordis'
import { SessionLog } from '../src/bundles/session-log/index.js'
import { EgressPolicy } from '../src/bundles/egress/index.js'
import { LLMService } from '../src/bundles/model-adapter/index.js'

if (process.env.HARNESS_LIVE_OPENROUTER !== '1') {
  console.error('Refusing live request. Set HARNESS_LIVE_OPENROUTER=1 to opt in.')
  process.exit(2)
}

const key = process.env.OPENROUTER_API_KEY
const model = process.env.OPENROUTER_MODEL

if (!key || !model) {
  console.error('OPENROUTER_API_KEY and OPENROUTER_MODEL are required.')
  process.exit(2)
}

const ctx = new Context()

await ctx.plugin(SessionLog, { memory: true })
await ctx.plugin(EgressPolicy, {
  projectId: 'openrouter-smoke',
  allowedHosts: ['openrouter.ai'],
})
await ctx.plugin(LLMService, {
  openaiCompatible: {
    name: 'openrouter-smoke',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: key,
    model,
    timeoutMs: 45000,
  },
  egress: { consent: true },
})

try {
  await ctx.egress.grantConsent()

  const result = await ctx.llm.complete({
    sessionId: 'openrouter-smoke',
    messages: [
      { role: 'user', content: 'Reply with exactly: HARNESS_OPENROUTER_OK' },
    ],
    // North Mini Code is reasoning-capable. 30 tokens can be consumed entirely
    // by reasoning, leaving no user-visible content. Leave enough budget for
    // reasoning and the short final answer.
    maxTokens: 512,
    temperature: 0,
  })

  const safe = result.text.replace(
    /(?:sk-or-v1-)?[A-Za-z0-9_-]{24,}/g,
    '[redacted-token]',
  )

  console.log(JSON.stringify({
    ok: result.text.includes('HARNESS_OPENROUTER_OK'),
    model: result.model,
    stopReason: result.stopReason,
    usage: result.usage,
    text: safe.slice(0, 300),
  }, null, 2))

  if (!result.text.includes('HARNESS_OPENROUTER_OK')) {
    process.exitCode = 1
  }
} catch (error) {
  const message = String(
    error instanceof Error ? error.message : error,
  ).replace(/(?:sk-or-v1-)?[A-Za-z0-9_-]{24,}/g, '[redacted-token]')

  console.error(`OpenRouter smoke failed: ${message.slice(0, 500)}`)
  process.exitCode = 1
}
