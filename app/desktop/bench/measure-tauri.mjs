// See README.md - this scaffolds and builds a real, minimal Tauri app using Tauri's own
// `create-tauri-app` CLI (not hand-written Cargo.toml/tauri.conf.json), so correctness comes
// from the official tool rather than from me guessing Rust project files I cannot compile-check
// here.
//
// NOT VERIFIED AT ALL in the environment that wrote this: this sandbox has no Rust/Cargo
// installed, and its network allowlist blocks rustup's own install host (confirmed: a request
// to static.rust-lang.org returned host_not_allowed). Nothing below - not the scaffold step, not
// the Rust source patch, not the build - has actually been run or compile-checked. Treat every
// error message from this script as more likely a real bug than in the Electron script, which at
// least got its scaffold step verified.

import { readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendResultRow, coldStartOnce, fail, fileSizeMB, findFirst, requireCommand, run, treeWorkingSetMB } from './measure-lib.mjs'

if (process.platform !== 'win32') {
  fail('this script measures the Windows build (installer .exe, tasklist memory) - run it on the 8 GB Windows machine, not here.')
}

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, 'hello-tauri')
const markerPath = join(tmpdir(), 'harness-bench-tauri-marker.txt')

await requireCommand(
  'cargo',
  ['--version'],
  'Tauri needs the Rust toolchain. Install it from https://rustup.rs, restart your terminal, then re-run this script.',
)
await requireCommand('npx', ['--version'], 'Install Node.js (npm ships npx with it).')

console.log('Scaffolding a minimal Tauri app with the official CLI (this may prompt once if --yes is not supported by the resolved version - answer with the vanilla/no-framework template)...')
if (existsSync(appDir)) await rm(appDir, { recursive: true, force: true })
await run('npm', ['create', 'tauri-app@latest', 'hello-tauri', '--', '--yes', '--template', 'vanilla', '--manager', 'npm'], { cwd: here }).catch(() => {
  fail(
    'scaffolding failed or needed interactive input this script did not provide. Run manually: ' +
      `"npm create tauri-app@latest" in ${here}, name it "hello-tauri", pick the vanilla/no-framework ` +
      'template and npm as the package manager, then re-run this script (it will skip re-scaffolding ' +
      'since hello-tauri/ will already exist - remove that check below if you want it to).',
  )
})

console.log('Installing frontend deps...')
await run('npm', ['install'], { cwd: appDir })

console.log('Patching in a static hello screen and a cold-start marker...')
await patchTauri(appDir, markerPath)

console.log('Building an installer (npm run tauri build - first build compiles Rust from scratch and can take several minutes)...')
await run('npm', ['run', 'tauri', 'build'], { cwd: appDir })

const bundleDir = join(appDir, 'src-tauri', 'target', 'release', 'bundle')
const installer = (await findFirst(bundleDir, (p) => p.endsWith('.exe'))) ?? (await findFirst(bundleDir, (p) => p.endsWith('.msi')))
if (!installer) fail(`no .exe or .msi found under ${bundleDir} - check the "tauri build" output above for the actual bundle path.`)
const appExe = join(appDir, 'src-tauri', 'target', 'release', 'hello-tauri.exe')
if (!existsSync(appExe)) {
  fail(`expected packaged app at ${appExe}, but it was not found.`)
}

console.log(`Installer: ${installer}`)
console.log(`Packaged app: ${appExe}`)

const installerSizeMB = await fileSizeMB(installer)

console.log('Measuring cold start (5 runs, launching the packaged app directly - not the installer wizard)...')
const samples = []
for (let i = 0; i < 5; i++) {
  const { ms } = await coldStartOnce(appExe, [], markerPath)
  console.log(`  run ${i + 1}: ${ms} ms`)
  samples.push(ms)
  await new Promise((r) => setTimeout(r, 500))
}
const coldStartMsAvg = samples.reduce((a, b) => a + b, 0) / samples.length

console.log('Measuring idle memory (app left running 5s, machine otherwise idle)...')
const launched = await import('node:child_process').then((cp) => cp.spawn(appExe, [], { stdio: 'ignore' }))
await new Promise((r) => setTimeout(r, 5000))
const { mb: idleMemoryMB, processCount } = await treeWorkingSetMB(launched.pid)
console.log(`  ${processCount} processes in the tree, ${idleMemoryMB.toFixed(1)} MB working set`)
try {
  launched.kill()
} catch {}

await appendResultRow(join(here, 'results.csv'), {
  shell: 'tauri',
  installerSizeMB,
  coldStartMsAvg,
  coldStartSamples: samples,
  idleMemoryMB,
  notes:
    "marker is written from Rust's setup() hook (webview created), not a frontend paint event - may under-count slightly vs. Electron's ready-to-show; hello-world only, no harness core logic added",
})

async function patchTauri(dir, marker) {
  const indexHtml = join(dir, 'index.html')
  if (existsSync(indexHtml)) {
    await writeFile(
      indexHtml,
      '<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font:24px sans-serif">hello</body></html>\n',
    )
  } else {
    console.log(`  (no ${indexHtml} found - template may use a src/ layout; hello-screen patch skipped, cold-start marker still applied)`)
  }

  const candidates = [join(dir, 'src-tauri', 'src', 'lib.rs'), join(dir, 'src-tauri', 'src', 'main.rs')]
  let patched = false
  for (const path of candidates) {
    if (!existsSync(path)) continue
    let rs = await readFile(path, 'utf8')
    if (!rs.includes('tauri::Builder::default()')) continue
    if (rs.includes('harness-bench')) {
      patched = true
      break
    }
    const markerLiteral = JSON.stringify(marker)
    rs = rs.replace(
      'tauri::Builder::default()',
      `tauri::Builder::default()\n        .setup(|_app| {\n            // harness-bench: cold-start marker, patched in by measure-tauri.mjs\n            let _ = std::fs::write(${markerLiteral}, format!("{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));\n            Ok(())\n        })`,
    )
    await writeFile(path, rs)
    patched = true
    break
  }
  if (!patched) {
    fail(
      `could not find "tauri::Builder::default()" in either src-tauri/src/lib.rs or main.rs to patch in the ` +
        'cold-start marker - the template structure may have changed between Tauri versions.',
    )
  }
}