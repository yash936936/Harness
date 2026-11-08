// Stand-in for the crabbox CLI used by test/sandbox.test.ts. argv[2] = state file, then the real crabbox args.
// State JSON: { leases: string[], calls: string[][], failWarmup?, failRun?, failStop?, stopNoop? }
import { readFileSync, writeFileSync } from 'node:fs'
const [, , stateFile, ...args] = process.argv
const st = JSON.parse(readFileSync(stateFile, 'utf8'))
st.calls.push(args)
st.forwardedUserDirs = Object.fromEntries(['APPDATA', 'LOCALAPPDATA', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP'].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]))
const save = () => writeFileSync(stateFile, JSON.stringify(st))
const sub = args[0]
const flag = (n) => args[args.indexOf(n) + 1]
if (sub === '--version') { console.log('crabbox 0.0.0-fake'); save() }
else if (sub === 'doctor') {
  if (st.failDoctor) { console.log('FAIL rsync not found on PATH'); console.error('doctor found problems'); save(); process.exit(1) }
  console.log('ok'); save()
}
else if (sub === 'warmup') {
  if (st.failWarmup) {
    if (st.warmupStdout) console.log(st.warmupStdout)
    console.error(st.warmupStderr ?? 'broker unreachable')
    save()
    process.exit(st.warmupExitCode ?? 1)
  }
  st.leases.push(flag('--slug')); console.log('leased ' + flag('--slug')); save()
} else if (sub === 'run') {
  const id = flag('--id'); const cmd = args.slice(args.indexOf('--') + 1)
  if (!st.leases.includes(id)) { console.error('no such lease'); save(); process.exit(3) }
  if (st.failRun) { console.error('boom'); save(); process.exit(7) }
  console.log(cmd.join(' ')); save()
} else if (sub === 'stop') {
  if (!st.stopNoop && !st.failStop) st.leases = st.leases.filter((l) => l !== args[args.length - 1])
  save(); process.exit(st.failStop ? 1 : 0)
} else if (sub === 'list') { console.log(st.leases.join('\n')); save() }
else { console.error('unknown ' + sub); process.exit(2) }
