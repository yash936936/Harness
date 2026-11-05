// Child process: node --import tsx memory-worker.ts <dir> <tag> <count> [nolock]
import { Context } from 'cordis'
import { EgressPolicy } from '../../src/bundles/egress/index.js'
import { HotTier } from '../../src/bundles/memory/hot.js'
import { JsonlEpisodeStore } from '../../src/bundles/memory/store.js'
const [dir, tag, count, mode] = process.argv.slice(2) as [string, string, string, string?]
const ctx = new Context()
await ctx.plugin(EgressPolicy, { projectId: 'p' })
const hot = new HotTier(ctx as any, dir, 100_000, (t: string) => Math.ceil(t.length / 4), () => new Date())
const eps = new JsonlEpisodeStore(dir)
if (mode === 'nolock') {
  // control: pre-fix behaviour = in-process cache of the whole list, no cross-process exclusion
  const h: any = hot
  const realLoad = h.load.bind(h)
  let cached: any
  h.load = async () => (cached ??= await realLoad())
  h.mutate = async (fn: any) => { const list = structuredClone(await h.load()); fn(list); await (await import('node:fs/promises')).writeFile(h.file, JSON.stringify(list), 'utf8'); cached = list }
}
for (let i = 0; i < Number(count); i++) {
  await hot.add({ text: `rule ${tag}-${i}`, id: `${tag}-${i}` })
  await eps.add({ id: `ep-${tag}-${i}`, ts: new Date().toISOString(), task: 't', approach: 'a', result: 'r', lesson: 'l' } as any)
}
