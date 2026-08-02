[CmdletBinding()]
param(
    [string]$Version = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = (Get-Content (Join-Path $PSScriptRoot '..\VERSION') -Raw).Trim()
}
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root
& go test ./...
if ($LASTEXITCODE -ne 0) { throw 'Go tests failed.' }
$jsTestDirectories = @((Join-Path $root 'web\js'), (Join-Path $root 'scripts'))
$jsTests = @(
    $jsTestDirectories |
        ForEach-Object { Get-ChildItem $_ -Filter '*.test.mjs' -File } |
        Sort-Object FullName |
        ForEach-Object FullName
)
& node --test @jsTests
if ($LASTEXITCODE -ne 0) { throw 'JavaScript tests failed.' }
$exe = Join-Path $root "artifacts\FaceForge BDO $Version - STANDALONE.exe"
if (-not (Test-Path $exe)) { throw "Missing executable: $exe" }
if ((Get-Item $exe).Length -lt 1MB) { throw 'Executable is unexpectedly small.' }
Write-Host 'Release verification passed.' -ForegroundColor Green
