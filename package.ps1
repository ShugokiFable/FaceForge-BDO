[CmdletBinding()]
param(
    [string]$Version = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = (Get-Content (Join-Path $PSScriptRoot 'VERSION') -Raw).Trim()
}
Set-Location $PSScriptRoot

& (Join-Path $PSScriptRoot 'build.ps1') -Version $Version
if ($LASTEXITCODE -ne 0) { throw 'Build pipeline failed.' }

$artifactDir = Join-Path $PSScriptRoot 'artifacts'
$sourceZip = Join-Path $artifactDir "FaceForge BDO $Version - SOURCE.zip"
if (Test-Path $sourceZip) { Remove-Item $sourceZip -Force }

$stage = Join-Path ([IO.Path]::GetTempPath()) "FaceForge-BDO-Source-$([guid]::NewGuid())"
try {
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    $excludedDirectories = @('.git', 'artifacts', 'dist', 'bin')
    $sourceItems = @(
        Get-ChildItem -LiteralPath $PSScriptRoot -Force |
            Where-Object {
                if ($_.PSIsContainer) {
                    return $_.Name -notin $excludedDirectories
                }
                return $_.Name -notlike 'FaceForge BDO * - STANDALONE.exe' -and
                    $_.Name -notlike '*.test.exe' -and
                    $_.Name -notlike '*.sha256'
            }
    )
    foreach ($item in $sourceItems) {
        Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $stage $item.Name) -Recurse -Force
    }
    $stageItems = @(Get-ChildItem -LiteralPath $stage -Force | ForEach-Object FullName)
    if ($stageItems.Count -eq 0) { throw 'Source staging directory is empty.' }
    Compress-Archive -LiteralPath $stageItems -DestinationPath $sourceZip -CompressionLevel Optimal
} finally {
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
}

@('README.md', 'START_HERE.txt', 'CHANGELOG.md', 'QA_REPORT.md', 'LAYOUT.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE') | ForEach-Object { Copy-Item $_ -Destination $artifactDir -Force }

$exe = Join-Path $artifactDir "FaceForge BDO $Version - STANDALONE.exe"
$manifest = Join-Path $artifactDir 'SHA256SUMS.txt'
$primaryFiles = @($exe, $sourceZip)
$lines = foreach ($file in $primaryFiles) {
    $hash = (Get-FileHash -Algorithm SHA256 $file).Hash.ToLowerInvariant()
    "$hash  $([IO.Path]::GetFileName($file))"
}
Set-Content -Path $manifest -Value $lines -Encoding ascii

$releaseZip = Join-Path $artifactDir "FaceForge BDO $Version - RELEASE.zip"
if (Test-Path $releaseZip) { Remove-Item $releaseZip -Force }
$bundleFiles = @(
    $exe,
    (Join-Path $artifactDir 'START_HERE.txt'),
    (Join-Path $artifactDir 'README.md'),
    (Join-Path $artifactDir 'CHANGELOG.md'),
    (Join-Path $artifactDir 'QA_REPORT.md'),
    (Join-Path $artifactDir 'THIRD_PARTY_NOTICES.md'),
    (Join-Path $artifactDir 'LICENSE'),
    $manifest
)
Compress-Archive -LiteralPath $bundleFiles -DestinationPath $releaseZip -CompressionLevel Optimal
$releaseHash = (Get-FileHash -Algorithm SHA256 $releaseZip).Hash.ToLowerInvariant()
Add-Content -Path $manifest -Value "$releaseHash  $([IO.Path]::GetFileName($releaseZip))" -Encoding ascii

Write-Host "Release package ready in $artifactDir" -ForegroundColor Green
