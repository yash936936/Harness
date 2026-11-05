// A second stand-in for the crabbox CLI, shaped like the REAL one per docs/commands/{warmup,list,stop}.md in openclaw/crabbox:
//  - warmup NORMALIZES the requested slug (adds a suffix) and prints `leased cbx_<12hex> slug=<slug> ...`
//  - list prints the lease's own cbx id + slug, not necessarily what the caller asked for
//  - state.blindList: list prints nothing at all; state.failStop: stop exits 1 and removes nothing
// argv[2] = state file. It records the cwd it was started in, because `crabbox run` syncs the CURRENT directory.
import { readFileSync, writeFileSync } from 'node:fs'
const [, , stateFile, ...args] = process.argv
const st = JSON.parse(readFileSync(stateFile, 'utf8'))
st.calls.push(args); st.cwds.push(process.cwd())
const save = () => writeFileSync(stateFile, JSON.stringify(st))
const sub = args[0]
const flag = (n) => args[args.indexOf(n) + 1]
if (sub === '--version') { console.log('crabbox 0.0.0-real-shaped'); save() }
else if (sub === 'warmup') {
  const slug = flag('--slug') + '-1a2b3c4d'
  st.leases.push({ id: 'cbx_0123456789ab', slug }); console.log(`leased cbx_0123456789ab slug=${slug} provider=local-container`); save()
} else if (sub === 'run') {
  const id = flag('--id')
  if (!st.leases.some((l) => l.id === id || l.slug === id)) { console.error('no such lease'); save(); process.exit(3) }
  console.log('ran'); save()
} else if (sub === 'stop') {
  const id = args[args.length - 1]
  if (st.failStop) { console.error('docker rm failed'); save(); process.exit(1) }
  st.leases = st.leases.filter((l) => l.id !== id && l.slug !== id); save()
} else if (sub === 'list') {
  if (!st.blindList) console.log(st.leases.map((l) => `${l.id}  ${l.slug}`).join('\n'))
  save()
} else { console.error('unknown ' + sub); process.exit(2) }
