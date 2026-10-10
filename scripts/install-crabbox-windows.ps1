# Official Crabbox native Windows installer, copied verbatim from docs/windows-install.md in github.com/openclaw/crabbox.
# Run in ordinary (non-elevated) PowerShell. Then close and reopen your terminals so PATH is refreshed.
$ErrorActionPreference = "Stop"
$minimumVersion = [version]"0.42.1"

$osArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
$architecture = switch ($osArchitecture) {
    "x64"   { "amd64" }
    "arm64" { "arm64" }
    default { throw "Unsupported Windows architecture: $osArchitecture" }
}

$headers = @{
    Accept = "application/vnd.github+json"
    "User-Agent" = "Crabbox-Windows-Installer"
}
$release = Invoke-RestMethod `
    -Uri "https://api.github.com/repos/openclaw/crabbox/releases/latest" `
    -Headers $headers
if ($release.draft -or $release.prerelease) {
    throw "The GitHub latest-release endpoint returned a non-stable release."
}

$version = $release.tag_name -replace '^v', ''
$stableVersion = [version]$version
if ($stableVersion -lt $minimumVersion) {
    throw "Latest stable Crabbox release v$version is older than required v$minimumVersion. Use a build from current main or wait for Crabbox v$minimumVersion or newer."
}

$archiveName = "crabbox_${version}_windows_${architecture}.zip"
$archiveAsset = $release.assets | Where-Object { $_.name -eq $archiveName } | Select-Object -First 1
$checksumsAsset = $release.assets | Where-Object { $_.name -eq "checksums.txt" } | Select-Object -First 1
if ($null -eq $archiveAsset -or $null -eq $checksumsAsset) {
    throw "Release assets are missing $archiveName or checksums.txt."
}

$downloadDir = Join-Path ([IO.Path]::GetTempPath()) ("crabbox-install-" + [guid]::NewGuid())
$archivePath = Join-Path $downloadDir $archiveName
$checksumsPath = Join-Path $downloadDir "checksums.txt"
$installDir = Join-Path $env:LOCALAPPDATA "Programs\Crabbox"
New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null

try {
    Invoke-WebRequest -Uri $archiveAsset.browser_download_url -OutFile $archivePath
    Invoke-WebRequest -Uri $checksumsAsset.browser_download_url -OutFile $checksumsPath

    $checksumPattern = '\s+\*?' + [regex]::Escape($archiveName) + '$'
    $checksumLine = Get-Content $checksumsPath |
        Where-Object { $_ -match $checksumPattern } |
        Select-Object -First 1
    if (-not $checksumLine) {
        throw "No checksum found for $archiveName."
    }
    $expectedHash = ($checksumLine.Trim() -split '\s+')[0]
    $actualHash = (Get-FileHash -Algorithm SHA256 -Path $archivePath).Hash
    if ($actualHash -ine $expectedHash) {
        throw "SHA-256 mismatch for $archiveName."
    }

    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    Expand-Archive -Path $archivePath -DestinationPath $installDir -Force
} finally {
    Remove-Item -LiteralPath $downloadDir -Recurse -Force -ErrorAction SilentlyContinue
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$userPathParts = @($userPath -split ';' | Where-Object { $_ })
if ($userPathParts -notcontains $installDir) {
    $updatedUserPath = (@($userPathParts) + $installDir) -join ';'
    [Environment]::SetEnvironmentVariable("Path", $updatedUserPath, "User")
}
if (($env:Path -split ';') -notcontains $installDir) {
    $env:Path = "$installDir;$env:Path"
}
