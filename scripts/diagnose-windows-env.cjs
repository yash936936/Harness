// Standalone diagnostic for DBG-008 / D-031 — run this directly, with no
// project dependencies, to find out whether an empty/small `env` object
// passed to Node's child_process.spawn actually restricts the child's
// environment on this machine, independent of anything in src/bundles/subprocess.
//
// Usage:  node scripts/diagnose-windows-env.cjs
// Paste the full output back — it's the ground truth needed to root-cause
// the Windows test failures in DBG-008 before any fix is trusted.

const { spawnSync } = require('node:child_process')

console.log('platform:', process.platform)
console.log('node:', process.version)
console.log('execPath:', process.execPath)
console.log()

function probe(label, env) {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], {
    env,
    shell: false,
    windowsHide: true,
  })
  console.log(`--- ${label} ---`)
  console.log('spawnSync error:', r.error ? r.error.message : null)
  console.log('status:', r.status, 'signal:', r.signal)
  const out = r.stdout ? r.stdout.toString('utf8') : ''
  let parsed
  try { parsed = JSON.parse(out) } catch { parsed = null }
  if (parsed) {
    console.log('child saw', Object.keys(parsed).length, 'env vars:', Object.keys(parsed).sort().join(', ') || '(none)')
  } else {
    console.log('raw stdout:', out.slice(0, 500))
    if (r.stderr) console.log('stderr:', r.stderr.toString('utf8').slice(0, 500))
  }
  console.log()
}

probe('env: {} (truly empty object)', {})
probe('env: { ONE: "1" } (single key, unrelated to any Windows-required var)', { ONE: '1' })
probe('env: undefined (Node default — should inherit everything)', undefined)
