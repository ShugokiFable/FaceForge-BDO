[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'publish-helpers.ps1')

$temp = Join-Path ([IO.Path]::GetTempPath()) "FaceForge-BDO-Publish-Test-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $temp -Force | Out-Null
Push-Location $temp
try {
    & git init *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create temporary Git repository.' }

    $missingOrigin = Get-GitRemoteUrl -Name 'origin'
    if ($null -ne $missingOrigin) { throw 'A new repository unexpectedly reported an origin remote.' }

    & git remote add origin 'https://github.com/ExampleOwner/FaceForge-BDO.git'
    if ($LASTEXITCODE -ne 0) { throw 'Could not add temporary origin remote.' }

    $origin = Get-GitRemoteUrl -Name 'origin'
    if ($origin -ne 'https://github.com/ExampleOwner/FaceForge-BDO.git') {
        throw "Unexpected origin URL: $origin"
    }

    $slug = Get-GitHubRepositorySlug -RemoteUrl $origin
    if ($slug -ne 'ExampleOwner/FaceForge-BDO') { throw "Unexpected GitHub slug: $slug" }

    if (Test-NativeCommandSucceeded { git rev-parse --verify 'refs/heads/definitely-missing' }) {
        throw 'Expected failing native command was reported as successful.'
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Expected lookup failure leaked LASTEXITCODE=$LASTEXITCODE."
    }

    Write-Host 'GitHub publisher helper tests passed.' -ForegroundColor Green
}
finally {
    Pop-Location
    if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
}

# Windows PowerShell can otherwise propagate a stale native exit code even after
# every assertion passes. Keep the CI contract explicit.
exit 0
