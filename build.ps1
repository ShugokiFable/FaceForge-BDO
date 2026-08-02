[CmdletBinding()]
param(
    [string]$Version = '',
    [switch]$SkipJavaScriptTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = (Get-Content (Join-Path $PSScriptRoot 'VERSION') -Raw).Trim()
}
Set-Location $PSScriptRoot

function Require-Command([string]$Name, [string]$InstallHint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name was not found. $InstallHint"
    }
}

Require-Command 'go' 'Install Go 1.22 or newer, then reopen PowerShell.'
if (-not $SkipJavaScriptTests) {
    Require-Command 'node' 'Install Node.js 20 or newer, then reopen PowerShell.'
}

Write-Host "[1/5] Formatting Go source..." -ForegroundColor Cyan
$unformatted = & gofmt -l .
if ($LASTEXITCODE -ne 0) { throw 'gofmt failed.' }
if ($unformatted) {
    throw "Go files require formatting:`n$($unformatted -join "`n")"
}

Write-Host "[2/5] Running Go tests..." -ForegroundColor Cyan
& go test ./...
if ($LASTEXITCODE -ne 0) { throw 'Go tests failed.' }

Write-Host "[3/5] Compiling Windows-only desktop tests..." -ForegroundColor Cyan
$compileCheck = Join-Path ([IO.Path]::GetTempPath()) "FaceForge-BDO-Windows-Compile-$([guid]::NewGuid()).test.exe"
$previousGOOS = $env:GOOS
$previousGOARCH = $env:GOARCH
$previousCGO = $env:CGO_ENABLED
try {
    $env:GOOS = 'windows'
    $env:GOARCH = 'amd64'
    $env:CGO_ENABLED = '0'
    & go test -c -o $compileCheck ./cmd/faceforge-bdo
    if ($LASTEXITCODE -ne 0) { throw 'Windows desktop compile check failed.' }
} finally {
    $env:GOOS = $previousGOOS
    $env:GOARCH = $previousGOARCH
    $env:CGO_ENABLED = $previousCGO
    if (Test-Path $compileCheck) { Remove-Item $compileCheck -Force }
}

if (-not $SkipJavaScriptTests) {
    Write-Host "[4/5] Running browser-logic tests..." -ForegroundColor Cyan
    $jsTestDirectories = @(
        (Join-Path $PSScriptRoot 'web\js'),
        (Join-Path $PSScriptRoot 'scripts')
    )
    $jsTests = @(
        $jsTestDirectories |
            ForEach-Object { Get-ChildItem $_ -Filter '*.test.mjs' -File } |
            Sort-Object FullName |
            ForEach-Object FullName
    )
    if ($jsTests.Count -eq 0) { throw 'No JavaScript tests were found.' }
    & node --test @jsTests
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript tests failed.' }
} else {
    Write-Host '[4/5] JavaScript tests skipped by request.' -ForegroundColor Yellow
}

Write-Host "[5/5] Building Windows standalone EXE..." -ForegroundColor Cyan
$artifactDir = Join-Path $PSScriptRoot 'artifacts'
New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null
$output = Join-Path $artifactDir "FaceForge BDO $Version - STANDALONE.exe"
$previousGOOS = $env:GOOS
$previousGOARCH = $env:GOARCH
$previousCGO = $env:CGO_ENABLED
try {
    $env:GOOS = 'windows'
    $env:GOARCH = 'amd64'
    $env:CGO_ENABLED = '0'
    & go build -trimpath -ldflags "-H windowsgui -s -w -X main.buildVersion=$Version" -o $output ./cmd/faceforge-bdo
    if ($LASTEXITCODE -ne 0) { throw 'Windows build failed.' }
} finally {
    $env:GOOS = $previousGOOS
    $env:GOARCH = $previousGOARCH
    $env:CGO_ENABLED = $previousCGO
}

$hash = (Get-FileHash -Algorithm SHA256 $output).Hash.ToLowerInvariant()
Set-Content -Path "$output.sha256" -Value "$hash  $([IO.Path]::GetFileName($output))" -Encoding ascii
Write-Host "Built native desktop app: $output" -ForegroundColor Green
Write-Host "SHA-256: $hash" -ForegroundColor Green
