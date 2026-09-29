// See README.md - this scaffolds and builds a real, minimal Electron app using Electron's own
// `create-electron-app` CLI (not a hand-written Cargo/Forge config), so correctness comes from
// the official tool rather than from me guessing a config shape I can't compile-check here.
//
// NOT VERIFIED END TO END in the environment that wrote this: this sandbox's network allowlist
// blocks Electron's own binary download (confirmed by hand - `npm install electron` here
// installs a 1.2 MB JS wrapper with no actual binary, silently). The scaffolding step (an npm
// package, not a native binary) was confirmed to run. Everything from "npm run make" onward is
// unverified. Read errors carefully; they're more likely to be real problems than in code that's
// actually been run.

import { readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendResultRow, coldStartOnce, fail, fileSizeMB, findFirst, requireCommand, run, treeWorkingSetMB } from './measure-lib.mjs'

if (process.platform !== 'win32') {
  fail('this script measures the Windows build (installer .exe, tasklist memory) - run it on the 8 GB Windows machine, not here.')
}

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, 'hello-electron')
const markerPath = join(tmpdir(), 'harness-bench-electron-marker.txt')

await requireCommand('npx', ['--version'], 'Install Node.js (npm ships npx with it).')

console.log('Scaffolding a minimal Electron app with the official CLI...')
if (existsSync(appDir)) await rm(appDir, { recursive: true, force: true })
await run('npx', ['--yes', 'create-electron-app@latest', 'hello-electron'], { cwd: here })

console.log('Patching in a static hello screen and a cold-start marker...')
await patchElectron(appDir, markerPath)

console.log('Building an installer (npm run make - this downloads the Electron binary and can take several minutes)...')
await run('npm', ['run', 'make'], { cwd: appDir })

const installer = await findFirst(join(appDir, 'out', 'make'), (p) => p.endsWith('.exe'))
if (!installer) fail(`no .exe found under ${join(appDir, 'out', 'make')} - check the "make" output above for the actual maker/output path and adjust this script.`)
const appExe = await findFirst(join(appDir, 'out'), (p) => p.endsWith('.exe'), ['make'])
if (!appExe) fail(`no packaged app .exe found under ${join(appDir, 'out')} (excluding out/make) - "npm run make" may have changed its layout.`)

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
  shell: 'electron',
  installerSizeMB,
  coldStartMsAvg,
  coldStartSamples: samples,
  idleMemoryMB,
  notes: 'hello-world only, no harness core logic added; idle memory is the shell alone, not measured alongside a running core process (see README caveat)',
})

async function patchElectron(dir, marker) {
  const mainJs = join(dir, 'src', 'main.js')
  const rendererJs = join(dir, 'src', 'renderer.js')

  if (!existsSync(mainJs) || !existsSync(rendererJs)) {
    fail(
      `expected ${mainJs} and ${rendererJs} from create-electron-app's Vite template - the template layout may have changed.`,
    )
  }

  // Replace the renderer with a minimal static page.
  await writeFile(
    rendererJs,
    `document.body.innerHTML = '<div style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font:24px sans-serif">hello</div>';\n`,
  )

  let main = await readFile(mainJs, 'utf8')

  if (!main.includes('ready-to-show')) {
    const markerLiteral = JSON.stringify(marker)

    const target =
      `mainWindow.loadFile(path.join(__dirname, \`../renderer/\${MAIN_WINDOW_VITE_NAME}/index.html\`));`

    if (!main.includes(target)) {
      fail(
        `could not find the expected Vite mainWindow.loadFile(...) call in ${mainJs}`,
      )
    }

    main = main.replace(
      target,
      `${target}
  mainWindow.once('ready-to-show', () => {
    require('node:fs').writeFileSync(${markerLiteral}, String(Date.now()));
  });`,
    )

    await writeFile(mainJs, main)
  }

  if (!main.includes('ready-to-show')) {
    fail(`could not add cold-start marker to ${mainJs}`)
  }
}