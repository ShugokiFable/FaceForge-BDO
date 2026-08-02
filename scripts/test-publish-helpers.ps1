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

    $captureSuccess = Invoke-NativeCommandCapture { git remote }
    if (-not $captureSuccess.Succeeded) { throw 'Successful native capture was reported as failed.' }
    if ($captureSuccess.ExitCode -ne 0) { throw "Unexpected successful capture exit code: $($captureSuccess.ExitCode)" }

    $captureFailure = Invoke-NativeCommandCapture { git rev-parse --verify 'refs/heads/still-definitely-missing' }
    if ($captureFailure.Succeeded) { throw 'Failing native capture was reported as successful.' }
    if ($captureFailure.ExitCode -eq 0) { throw 'Failing native capture lost its original exit code.' }
    if ($LASTEXITCODE -ne 0) { throw "Native capture leaked LASTEXITCODE=$LASTEXITCODE." }

    $workflowRuns = @(
        [pscustomobject]@{ databaseId = 30766673132; headSha = 'new-head'; createdAt = '2026-08-02T20:54:55Z'; status = 'in_progress' }
        [pscustomobject]@{ databaseId = 30766445484; headSha = 'old-head'; createdAt = '2026-08-02T20:48:45Z'; status = 'completed' }
        [pscustomobject]@{ databaseId = 30766000000; headSha = 'new-head'; createdAt = '2026-08-02T20:40:00Z'; status = 'completed' }
    ) | ConvertTo-Json
    $selectedRunId = Get-NewestMatchingWorkflowRunId -Json $workflowRuns -HeadSha 'new-head'
    if ($selectedRunId -ne '30766673132') {
        throw "Expected newest matching run 30766673132, got '$selectedRunId'."
    }
    if ($selectedRunId -is [array]) {
        throw 'Workflow run selector returned an array instead of one scalar ID.'
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
