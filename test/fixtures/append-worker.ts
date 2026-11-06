// Child process for the cross-process tests: node --import tsx append-worker.ts <dir> <sessionId> <count> <tag> [nolock]
import { appendFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionLog } from '../../src/bundles/session-log/index.js'
import { withFileLock } from '../../src/util/filelock.js'
import { Context } from 'cordis'
const [dir, sid, count, tag, mode] = process.argv.slice(2) as [string, string, string, string, string?]
const ctx = new Context()
await ctx.plugin(SessionLog, { path: dir })
if (mode === 'hold-lock') {
  const lockPath = join(dir, 'paused-holder.lock')
  await withFileLock(lockPath, async () => {
    await writeFile(join(dir, 'holder.ready'), String(process.pid))
    const releasePath = join(dir, 'holder.release')
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      try { await import('node:fs/promises').then(({ access }) => access(releasePath)); return } catch {}
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('holder release timed out')
  }, { staleMs: 100, timeoutMs: 2000 })
  process.exit(0)
}
if (mode === 'crash-lock') {
  await withFileLock(join(dir, 'crashed-holder.lock'), async () => {
    await writeFile(join(dir, 'crash.ready'), String(process.pid))
    process.exit(24)
  }, { staleMs: 100, timeoutMs: 2000 })
}
if (mode === 'crash-tail') {
  // Simulate a process dying after a partial JSONL write.
  await ctx.log.append(sid, 'before-crash', { tag })
  await appendFile(join(dir, `${sid}`.concat('.jsonl')), '{"seq":2,"ts":"interrupted","sessionId":')
  process.exit(23)
}
if (mode === 'nolock') {
  // Reproduce the pre-lock race deterministically. Each process reads/caches
  // the same last sequence before any process is allowed to append its event.
  const store: any = (ctx.log as any).store
  store.withLock = undefined
  store.lastSeq = undefined
  const readyDir = join(dir, '.nolock-ready')
  await mkdir(readyDir, { recursive: true })
  const originalAppend = store.append.bind(store)
  let firstAppend = true
  store.append = async (event: unknown) => {
    if (firstAppend) {
      firstAppend = false
      await writeFile(join(readyDir, `${tag}.ready`), 'ready')
      const deadline = Date.now() + 10_000
      for (;;) {
        const ready = (await readdir(readyDir)).filter((name) => name.endsWith('.ready'))
        if (ready.length >= 3) break
        if (Date.now() >= deadline) throw new Error('timed out waiting for no-lock workers at the race barrier')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
    return originalAppend(event)
  }
}
for (let i = 0; i < Number(count); i++) await ctx.log.append(sid, 'work', { tag, i })
