// Child process for the cross-process tests: node --import tsx append-worker.ts <dir> <sessionId> <count> <tag> [nolock]
import { SessionLog } from '../../src/bundles/session-log/index.js'
import { Context } from 'cordis'
const [dir, sid, count, tag, mode] = process.argv.slice(2) as [string, string, string, string, string?]
const ctx = new Context()
await ctx.plugin(SessionLog, { path: dir })
if (mode === 'nolock') {
  // control: the pre-fix behaviour (no cross-process lock, seq from an in-process cache)
  const store: any = (ctx.log as any).store
  store.withLock = undefined
  store.lastSeq = undefined
}
for (let i = 0; i < Number(count); i++) await ctx.log.append(sid, 'work', { tag, i })
