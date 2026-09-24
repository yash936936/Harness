import { describe, expect, it } from 'vitest'
import { MockProvider } from '../src/bundles/model-adapter/index.js'
import { bootProfileMinimal } from '../src/profiles/profile-minimal.js'

describe('profile-minimal: end-to-end wiring (1.6)', () => {
  it('boots from one config call with no manual wiring, and completes a single-agent task', async () => {
    const ctx = await bootProfileMinimal({ projectId: 'test', sessionLog: { memory: true } })
    // ctx.log / ctx.llm / ctx.tools / ctx.subprocess / ctx.agentLoop all live off one boot call.
    expect(ctx.log).toBeTruthy()
    expect(ctx.llm).toBeTruthy()
    expect(ctx.tools).toBeTruthy()
    expect(ctx.subprocess).toBeTruthy()
    expect(ctx.agentLoop).toBeTruthy()

    ctx.llm.register('mock', new MockProvider([{ text: 'hello from profile-minimal', toolCalls: [] }]), { default: true })

    const sessionId = ctx.log.create()
    const result = await ctx.agentLoop.run({ sessionId, prompt: 'say hi' })

    expect(result.stopReason).toBe('done')
    expect(result.finalText).toBe('hello from profile-minimal')
  })

  it('the session log alone reconstructs the full story of the run ("model-visible = logged" end-to-end)', async () => {
    const ctx = await bootProfileMinimal({ projectId: 'test', sessionLog: { memory: true } })
    ctx.llm.register('mock', new MockProvider([{ text: 'done', toolCalls: [] }]), { default: true })

    const sessionId = ctx.log.create()
    const result = await ctx.agentLoop.run({ sessionId, prompt: 'say hi' })

    const events = await ctx.log.read(sessionId)
    const types = events.map((e) => e.type)

    // The model call the loop made is fully visible in the log, in order.
    expect(types).toContain('model.request')
    expect(types).toContain('model.response')
    expect(types.indexOf('model.request')).toBeLessThan(types.indexOf('model.response'))

    // Seq is strictly increasing and gapless - a replay reconstructs the same order every time.
    for (let i = 0; i < events.length; i++) expect(events[i]!.seq).toBe(i + 1)

    // The response's own text matches what the loop actually returned - the log isn't a
    // parallel, potentially-drifting record, it's the same data the caller got back.
    const responseEvent = events.find((e) => e.type === 'model.response')!
    expect((responseEvent.data as any).text).toBe(result.finalText)
  })

  it('a fresh boot has no cross-run state leakage from a previous run', async () => {
    const ctx1 = await bootProfileMinimal({ projectId: 'test', sessionLog: { memory: true } })
    ctx1.llm.register('mock', new MockProvider([{ text: 'first-run-only', toolCalls: [] }]), { default: true })
    const s1 = ctx1.log.create()
    await ctx1.agentLoop.run({ sessionId: s1, prompt: 'task' })

    const ctx2 = await bootProfileMinimal({ projectId: 'test', sessionLog: { memory: true } })
    // No provider named 'mock' has been registered on this fresh ctx - if state leaked from
    // ctx1, this would still resolve; instead it must fail closed with a config error.
    const sessionId2 = ctx2.log.create()
    await expect(ctx2.agentLoop.run({ sessionId: sessionId2, prompt: 'task', provider: 'mock' })).rejects.toThrow()

    // And re-running the same session id on the fresh ctx starts a clean log, not one carrying
    // over ctx1's events (different in-memory stores entirely, but assert the observable property).
    const events2 = await ctx2.log.read(s1)
    expect(events2).toEqual([])
  })

  it('subprocess is live under profile-minimal (available for a future tool wrapper, 1.4)', async () => {
    const ctx = await bootProfileMinimal({ projectId: 'test', sessionLog: { memory: true }, subprocess: { envAllowlist: [] } })
    const res = await ctx.subprocess.run(process.execPath, ['-e', 'process.stdout.write("ok")'])
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toBe('ok')
  })

  it('rejects an unregistered tool name before any model call, same as agent-loop alone (1.3+1.5 wired correctly)', async () => {
    const ctx = await bootProfileMinimal({ projectId: 'test', sessionLog: { memory: true } })
    ctx.llm.register('mock', new MockProvider([]), { default: true })
    const sessionId = ctx.log.create()
    await expect(ctx.agentLoop.run({ sessionId, prompt: 'x', tools: ['does-not-exist'] })).rejects.toThrow()
    const events = await ctx.log.read(sessionId)
    expect(events.some((e) => e.type === 'model.request')).toBe(false)
  })
})
