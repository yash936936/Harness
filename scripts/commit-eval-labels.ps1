param(
    [Parameter(Mandatory = $true)]
    [string]$LabelsPath
)

$ErrorActionPreference = "Stop"

$resolved = (Resolve-Path -LiteralPath $LabelsPath).Path
$repoRootRaw = (git rev-parse --show-toplevel).Trim()
$repoRoot = (Resolve-Path -LiteralPath $repoRootRaw).Path
if ($LASTEXITCODE -ne 0 -or -not $repoRoot) {
    throw "Run this script from inside the Harness Git repository."
}

$rootPrefix = $repoRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
if (-not $resolved.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Labels file must be inside the repository."
}

$relative = $resolved.Substring($rootPrefix.Length).Replace('\', '/')
$hash = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
$sidecar = $resolved + ".sha256"
$sidecarRelative = $relative + ".sha256"
Set-Content -LiteralPath $sidecar -Value ($hash + "  " + [IO.Path]::GetFileName($resolved)) -Encoding ASCII

git add -- $relative $sidecarRelative
if ($LASTEXITCODE -ne 0) { throw "git add failed." }

git commit -m "data(eval): commit blinded labels and SHA-256" -- $relative $sidecarRelative
if ($LASTEXITCODE -ne 0) { throw "git commit failed. Resolve the Git error before running the scorer." }

$workingBlob = (git hash-object -- $relative).Trim()
$committedBlob = (git rev-parse ("HEAD:" + $relative)).Trim()
if ($LASTEXITCODE -ne 0 -or $workingBlob -ne $committedBlob) {
    throw "Committed labels do not match the working file."
}

$committedSidecar = (git show ("HEAD:" + $sidecarRelative)).Trim()
if ($committedSidecar -ne ($hash + "  " + [IO.Path]::GetFileName($resolved))) {
    throw "Committed SHA-256 sidecar does not match the labels file."
}

$dirty = git status --porcelain -- $relative $sidecarRelative
if ($LASTEXITCODE -ne 0 -or $dirty) {
    throw "Labels or hash sidecar are not clean after commit."
}

$commit = (git rev-parse HEAD).Trim()
Write-Output ("Labels SHA-256: " + $hash)
Write-Output ("Committed at: " + $commit)
Write-Output "Only now run the scorer. Do not inspect scorer output before this commit."
