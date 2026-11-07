param(
    [Parameter(Mandatory = $true)]
    [string]$LabelsPath
)

$ErrorActionPreference = "Stop"

$resolved = (Resolve-Path -LiteralPath $LabelsPath).Path
$repoRootRaw = (git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $repoRootRaw) {
    throw "Run this script from inside the Harness Git repository."
}
$repoRoot = (Resolve-Path -LiteralPath $repoRootRaw).Path
$rootPrefix = $repoRoot.TrimEnd([char[]]@(92, 47)) + [IO.Path]::DirectorySeparatorChar
if (-not $resolved.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Labels file must be inside the repository."
}

$relative = $resolved.Substring($rootPrefix.Length).Replace([string][char]92, "/")
$sidecar = $resolved + ".sha256"
$sidecarRelative = $relative + ".sha256"

# Stage labels first, then hash the staged Git blob after clean filters.
# This remains stable with core.autocrlf=true on Windows.
git add -- $relative
if ($LASTEXITCODE -ne 0) { throw "git add for labels failed." }

$hashOutput = & npx tsx scripts/eval-label-provenance.ts --hash-index $resolved
if ($LASTEXITCODE -ne 0) { throw "Could not hash the staged Git labels blob." }
$hash = ($hashOutput | Out-String).Trim().ToLowerInvariant()
if ($hash -notmatch '^[0-9a-f]{64}$') { throw "The staged labels hash was not a SHA-256 digest." }

Set-Content -LiteralPath $sidecar -Value ($hash + "  " + [IO.Path]::GetFileName($resolved)) -Encoding ASCII

git add -- $sidecarRelative
if ($LASTEXITCODE -ne 0) { throw "git add for SHA-256 sidecar failed." }

git commit -m "data(eval): commit blinded labels and SHA-256" -- $relative $sidecarRelative
if ($LASTEXITCODE -ne 0) { throw "git commit failed. Resolve the Git error before running the scorer." }

$committedSidecar = (git show ("HEAD:" + $sidecarRelative)).Trim()
if ($LASTEXITCODE -ne 0 -or $committedSidecar -ne ($hash + "  " + [IO.Path]::GetFileName($resolved))) {
    throw "Committed SHA-256 sidecar does not match the staged labels blob."
}

$committedHashOutput = & npx tsx scripts/eval-label-provenance.ts --hash-index $resolved
if ($LASTEXITCODE -ne 0) { throw "Could not verify the committed labels blob hash." }
$committedHash = ($committedHashOutput | Out-String).Trim().ToLowerInvariant()
if ($committedHash -ne $hash) { throw "Committed labels changed after the SHA-256 sidecar was written." }

$dirty = git status --porcelain -- $relative $sidecarRelative
if ($LASTEXITCODE -ne 0 -or $dirty) {
    throw "Labels or hash sidecar are not clean after commit."
}

$commit = (git rev-parse HEAD).Trim()
Write-Output ("Labels Git-blob SHA-256: " + $hash)
Write-Output ("Committed at: " + $commit)
Write-Output "Only now run the scorer. Do not inspect scorer output before this commit."
