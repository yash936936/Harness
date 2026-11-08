[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$ContainerId
)

$ErrorActionPreference = 'Continue'

function Get-AppCommand([string]$Name) {
    return Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
}

Write-Output '=== Harness Crabbox preflight (read-only) ==='

$names = @('crabbox.exe', 'docker.exe', 'git.exe', 'ssh.exe', 'ssh-keygen.exe', 'curl.exe', 'rsync.exe')
$commands = @{}
foreach ($name in $names) {
    $cmd = Get-AppCommand $name
    if ($cmd) {
        $commands[$name] = $cmd
        Write-Output ($name + '=' + $cmd.Source)
    } else {
        Write-Output ($name + '=MISSING')
    }
}

$wsl = Get-AppCommand 'wsl.exe'
if ($wsl) {
    $wslOutput = & $wsl.Source sh -c 'command -v rsync || exit 1; command -v ssh || exit 1' 2>&1
    $wslExit = $LASTEXITCODE
    if ($wslExit -eq 0) {
        Write-Output ('WSL_DEFAULT_TRANSFER=OK ' + (($wslOutput | ForEach-Object { "$_" }) -join '; '))
    } else {
        Write-Output ('WSL_DEFAULT_TRANSFER=FAIL ' + (($wslOutput | ForEach-Object { "$_" }) -join '; '))
    }
} else {
    Write-Output 'WSL_DEFAULT_TRANSFER=NOT_INSTALLED'
}

$rsync = $commands['rsync.exe']
if ($rsync) {
    $siblingSsh = Join-Path (Split-Path -Parent $rsync.Source) 'ssh.exe'
    if (Test-Path -LiteralPath $siblingSsh -PathType Leaf) {
        Write-Output ('WINDOWS_RSYNC_SIBLING_SSH=' + $siblingSsh)
    } else {
        Write-Output 'WINDOWS_RSYNC_SIBLING_SSH=MISSING'
    }
}

$docker = $commands['docker.exe']
if ($docker) {
    $context = & $docker.Source context show 2>&1
    $contextExit = $LASTEXITCODE
    $version = & $docker.Source info --format '{{.ServerVersion}}' 2>&1
    $infoExit = $LASTEXITCODE
    if ($contextExit -eq 0) { Write-Output ('DOCKER_CONTEXT=' + (($context | ForEach-Object { "$_" }) -join ' ')) }
    else { Write-Output ('DOCKER_CONTEXT=FAIL ' + (($context | ForEach-Object { "$_" }) -join ' ')) }
    if ($infoExit -eq 0) { Write-Output ('DOCKER_ENGINE=' + (($version | ForEach-Object { "$_" }) -join ' ')) }
    else { Write-Output ('DOCKER_ENGINE=UNAVAILABLE ' + (($version | ForEach-Object { "$_" }) -join ' ')) }
}

$crabbox = $commands['crabbox.exe']
if ($crabbox) {
    $doctor = & $crabbox.Source doctor --provider local-container --local-container-runtime docker 2>&1
    $doctorExit = $LASTEXITCODE
    Write-Output ('CRABBOX_DOCTOR_EXIT=' + $doctorExit)
    $doctor | Select-Object -Last 12 | ForEach-Object { Write-Output "$_" }
}

if ($ContainerId) {
    if (-not $docker) {
        Write-Output 'CONTAINER_DIAGNOSTICS=SKIPPED_DOCKER_MISSING'
    } else {
        $inspect = & $docker.Source inspect --format '{{.State.Status}} exit={{.State.ExitCode}} error={{.State.Error}}' $ContainerId 2>&1
        $inspectExit = $LASTEXITCODE
        Write-Output ('CONTAINER_INSPECT_EXIT=' + $inspectExit)
        $inspect | ForEach-Object { Write-Output "$_" }

        Write-Output 'CONTAINER_LOG_TAIL:'
        & $docker.Source logs --tail 12 $ContainerId 2>&1 | ForEach-Object { Write-Output "$_" }

        Write-Output 'CONTAINER_EVENTS_TAIL:'
        & $docker.Source events --since 48h --filter ('container=' + $ContainerId) --format '{{.Time}} {{.Action}} exit={{.Actor.Attributes.exitCode}}' 2>&1 |
            Select-Object -Last 12 | ForEach-Object { Write-Output "$_" }
    }
}

Write-Output 'SAFETY=read-only; this script does not warmup, stop, remove, or modify containers.'
