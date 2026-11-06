param(
  [Parameter(Mandatory=$true)][string]$PsSuspendPath
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $PsSuspendPath)) { throw "PsSuspend.exe not found: $PsSuspendPath" }
if (-not (Test-Path 'node_modules/.bin/vitest.cmd')) { throw 'Install dependencies first with npm ci' }
$env:HARNESS_PSSUSPEND = (Resolve-Path $PsSuspendPath).Path
npm run test -- --run test/session-log-multiprocess.test.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
