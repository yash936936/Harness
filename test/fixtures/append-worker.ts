// Child process for the cross-process tests: node --import tsx append-worker.ts <dir> <sessionId> <count> <tag> [nolock]
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionLog } from '../../src/bundles/session-log/index.js'
import { Context } from 'cordis'
const [dir, sid, count, tag, mode] = process.argv.slice(2) as [string, string, string, string, string?]
const ctx = new Context()
await ctx.plugin(SessionLog, { path: dir })
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
