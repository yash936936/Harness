# Electron vs Tauri measurement (1B.4, D-025)

**Nothing here is measured yet.** D-025 requires both to be measured on
your actual 8 GB machine before either is chosen - a number typed in by
me, on hardware I don't have, would be exactly the kind of fabricated
claim this project's `docs/decisions.md` repeatedly refuses to make
elsewhere (D-020, D-037, D-041). This folder is the tool to produce real
numbers; it produces none on its own.

## What "measured" means here

For each shell (Electron, Tauri), three numbers, from a build that does
nothing but display a static "hello" screen - not the real app, since the
point is measuring the shell's own overhead before any of this project's
logic is added:

1. **Installer size** - the packaged installer file, in MB.
2. **Cold start** - wall-clock time from launching the installed app to
   its window becoming visible, averaged over 5 runs, machine otherwise
   idle.
3. **Idle memory with the core running** - the shell's own process
   working-set memory, several seconds after startup with nothing
   happening, while `npm run harness -- run ...` (or an equivalent script
   running the Node core) is also running alongside it - this is the
   number that actually matters for the 8 GB budget, not the shell alone.

## How to run it

```powershell
cd app\desktop\bench
npm install
npm run measure:electron
npm run measure:tauri    # needs the Rust toolchain; the script tells you if it's missing
```

Each command builds a minimal hello-world shell, measures it, and appends
one row to `results.csv` in this folder with a timestamp, so re-runs don't
overwrite history. Nothing here uploads anywhere or calls any network
endpoint beyond `npm install`'s own registry access, which you already
trust for the rest of this project.

## What was actually verified, and what wasn't (D-045)

This toolkit was written in a sandbox with no Windows, no Rust toolchain,
and a network allowlist that blocks both Electron's binary download and
Rust's own installer host - confirmed by hand, not assumed. So:

**Verified for real, in that sandbox:**
- `measure-lib.mjs`'s file-tree walk (`findFirst`, distinguishing an
  installer under `out/make/` from the packaged app exe next to it),
  `fileSizeMB`, and `appendResultRow`'s CSV writing (including quoting) -
  exercised against a fake directory tree built to mirror Electron
  Forge's real output layout.
- The cold-start timer (`coldStartOnce`) - exercised against a fake "app"
  (a plain Node script that writes the marker file after a deliberate
  300 ms delay) and confirmed it measures close to that delay.
- The Windows `tasklist /FO CSV` parsing in `workingSetMB` - exercised
  against sample output shaped like a real multi-process Electron app,
  confirmed it sums every matching process and ignores others.
- `create-electron-app`'s scaffold step actually runs (it's an npm
  package, not a native binary) - confirmed by running it.

**Not verified at all:**
- Everything from `npm run make` / `npm run tauri build` onward: the
  actual Electron/Tauri builds, both regex-based source patches (finding
  `mainWindow.loadFile(...)` in Electron's `main.js`; finding
  `tauri::Builder::default()` in Tauri's `lib.rs`/`main.rs`), and whether
  the resulting apps actually launch and hit their marker.
- Whether `create-tauri-app`'s CLI flags (`--yes --template vanilla
  --manager npm`) are still correct for whatever version resolves as
  "latest" when you run this - Tauri's scaffolder has changed its
  flags across major versions before.

If a script fails, the error is more likely a real bug in that
unverified 20% than in the parts above - check what it actually printed
before assuming your machine is misconfigured.

## After you have real numbers

Paste `results.csv` back. I will not choose Electron or Tauri from a
guess - D-025 requires the choice to be a logged decision (`D-0NN` in
`docs/decisions.md`) citing these three numbers, on this machine, and
that means the numbers have to exist first.
