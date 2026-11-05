$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..\app\desktop\bench\hello-tauri'
$marker = Join-Path ([System.IO.Path]::GetTempPath()) 'harness-bench-tauri-marker.txt'
Push-Location $root
try {
  Remove-Item $marker -Force -ErrorAction SilentlyContinue

  $buildStart = [System.Diagnostics.Stopwatch]::StartNew()
  npm exec tauri build
  $buildStart.Stop()

  $exe = Get-ChildItem -Path 'src-tauri\target\release' -Filter '*.exe' -File |
    Where-Object { $_.Name -notmatch 'uninstall|setup' } |
    Select-Object -First 1
  if (-not $exe) { throw 'Release Tauri executable not found after build' }

  $bundleRoot = Join-Path (Get-Location) 'src-tauri\target\release\bundle'
  $bundleFiles = @()
  if (Test-Path $bundleRoot) {
    $bundleFiles = @(Get-ChildItem $bundleRoot -Recurse -File |
      Where-Object { $_.Extension -in '.msi', '.exe', '.appx', '.msix' })
  }
  $bundleBytes = ($bundleFiles | Measure-Object -Property Length -Sum).Sum
  if ($null -eq $bundleBytes) { $bundleBytes = 0 }

  $processStart = [System.Diagnostics.Stopwatch]::StartNew()
  $proc = Start-Process -FilePath $exe.FullName -PassThru
  $startupMs = $null
  $workingSetMiB = $null
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline -and -not $proc.HasExited) {
    if (Test-Path $marker) {
      $markerValue = (Get-Content $marker -Raw).Trim()
      if ($markerValue -match '^\d+$') {
        $appReadyUnixMs = [int64]$markerValue
        $appReadyUtc = [DateTimeOffset]::FromUnixTimeMilliseconds($appReadyUnixMs)
        $startupMs = [math]::Round($processStart.Elapsed.TotalMilliseconds, 1)
        $proc.Refresh()
        $workingSetMiB = [math]::Round($proc.WorkingSet64 / 1MB, 1)
        break
      }
    }
    Start-Sleep -Milliseconds 100
    $proc.Refresh()
  }
  $processStart.Stop()
  $exitedBeforeReady = $proc.HasExited -and $null -eq $startupMs
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }

  $result = [ordered]@{
    timestampUtc = (Get-Date).ToUniversalTime().ToString('o')
    os = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
    architecture = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
    configuration = 'release'
    buildSeconds = [math]::Round($buildStart.Elapsed.TotalSeconds, 2)
    executableBytes = $exe.Length
    installerBundleBytes = [int64]$bundleBytes
    installerFiles = @($bundleFiles | ForEach-Object { [ordered]@{ name = $_.Name; bytes = $_.Length } })
    coldStartToTauriSetupMs = $startupMs
    workingSetMiBAfterSetup = $workingSetMiB
    exitedBeforeReady = $exitedBeforeReady
    startupTimeoutSeconds = 30
  }
  $result | ConvertTo-Json -Depth 5 | Tee-Object -FilePath 'tauri-benchmark.json'
  if ($null -eq $startupMs) { throw 'Tauri app did not reach setup marker within 30 seconds; see tauri-benchmark.json' }
} finally {
  Pop-Location
}
