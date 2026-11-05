$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..\app\desktop\bench\hello-tauri'
Push-Location $root
try {
  $start = Get-Date
  npm exec tauri build -- --debug
  $buildSeconds = ((Get-Date) - $start).TotalSeconds
  $exe = Get-ChildItem -Path 'src-tauri\target\debug' -Filter '*.exe' -Recurse | Select-Object -First 1
  if (-not $exe) { throw 'Tauri executable not found after build' }
  $proc = Start-Process -FilePath $exe.FullName -PassThru
  Start-Sleep -Seconds 5
  $proc.Refresh()
  $workingSet = if ($proc.HasExited) { $null } else { [math]::Round($proc.WorkingSet64 / 1MB, 1) }
  $result = [ordered]@{ timestampUtc = (Get-Date).ToUniversalTime().ToString('o'); os = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription; buildSeconds = [math]::Round($buildSeconds, 2); executable = $exe.FullName; pid = $proc.Id; workingSetMiBAfter5s = $workingSet; exitedWithin5s = $proc.HasExited }
  $result | ConvertTo-Json | Tee-Object -FilePath 'tauri-benchmark.json'
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
} finally { Pop-Location }
