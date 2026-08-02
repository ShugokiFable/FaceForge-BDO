[CmdletBinding()]
param(
    [string]$Repository = 'FaceForge-BDO',
    [ValidateSet('Public', 'Private')]
    [string]$Visibility = 'Public',
    [string]$Owner = '',
    [string]$CommitMessage = '',
    [switch]$CreateRelease,
    [string]$Version = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = (Get-Content (Join-Path $PSScriptRoot 'VERSION') -Raw).Trim()
}
if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
    $CommitMessage = "Release FaceForge BDO $Version"
}
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'scripts\publish-helpers.ps1')

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is required.' }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI is required. Install it, then run: gh auth login' }
Invoke-Checked { gh auth status } 'GitHub CLI is not authenticated. Run: gh auth login'

if ([string]::IsNullOrWhiteSpace($Owner)) {
    $Owner = (& gh api user --jq .login).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Owner)) { throw 'Could not determine the authenticated GitHub account.' }
}
$fullName = "$Owner/$Repository"

if (-not (Test-Path '.git')) {
    Invoke-Checked { git init } 'Could not initialize the Git repository.'
}

$gitName = @(& git config --get user.name)
if ($LASTEXITCODE -notin @(0, 1)) { throw 'Could not inspect the local Git author name.' }
if ([string]::IsNullOrWhiteSpace(($gitName -join ''))) {
    Invoke-Checked { git config user.name $Owner } 'Could not configure the local Git author name.'
}
$gitEmail = @(& git config --get user.email)
if ($LASTEXITCODE -notin @(0, 1)) { throw 'Could not inspect the local Git author email.' }
if ([string]::IsNullOrWhiteSpace(($gitEmail -join ''))) {
    Invoke-Checked { git config user.email "$Owner@users.noreply.github.com" } 'Could not configure the local Git author email.'
}

Invoke-Checked { git add --all } 'Could not stage the project files.'
$changes = & git status --porcelain
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Git status.' }
if ($changes) {
    Invoke-Checked { git commit -m $CommitMessage } 'Could not commit the current files.'
}
Invoke-Checked { git branch -M main } 'Could not rename the current branch to main.'

$canonicalOrigin = "https://github.com/$fullName.git"
$origin = Get-GitRemoteUrl -Name 'origin'

# An origin entry only proves that the local repository remembers a URL. It does
# not prove that the GitHub repository still exists. Always verify the remote
# repository before attempting to push, and recreate an empty remote when it was
# deleted between publish runs.
if (-not [string]::IsNullOrWhiteSpace($origin)) {
    $originSlug = Get-GitHubRepositorySlug -RemoteUrl $origin
    if ([string]::IsNullOrWhiteSpace($originSlug)) {
        throw "origin points to '$origin', which is not a supported GitHub repository URL. Expected $fullName."
    }
    if (-not $originSlug.Equals($fullName, [StringComparison]::OrdinalIgnoreCase)) {
        throw "origin points to '$originSlug', but this publish run expected '$fullName'. Change the repository name or correct the origin remote before retrying."
    }
}

$repositoryExists = Test-NativeCommandSucceeded { gh repo view $fullName --json nameWithOwner }
if (-not $repositoryExists) {
    Write-Host "GitHub repository $fullName is missing. Recreating it before push..." -ForegroundColor Yellow
    $visibilitySwitch = if ($Visibility -eq 'Private') { '--private' } else { '--public' }
    Invoke-Checked {
        gh repo create $fullName $visibilitySwitch
    } "Could not create or access $fullName. Run 'gh auth refresh -h github.com -s repo,workflow' and retry."
}

if ([string]::IsNullOrWhiteSpace($origin)) {
    Invoke-Checked { git remote add origin $canonicalOrigin } "Could not add origin for $fullName."
}
else {
    # Canonicalize the URL even when the slug already matches. This removes stale
    # redirects, trailing slashes, and renamed/deleted repository URLs.
    Invoke-Checked { git remote set-url origin $canonicalOrigin } "Could not update origin for $fullName."
}

$origin = Get-GitRemoteUrl -Name 'origin'
if ([string]::IsNullOrWhiteSpace($origin)) {
    throw 'GitHub repository setup completed without creating an origin remote.'
}
$originSlug = Get-GitHubRepositorySlug -RemoteUrl $origin
if ([string]::IsNullOrWhiteSpace($originSlug) -or -not $originSlug.Equals($fullName, [StringComparison]::OrdinalIgnoreCase)) {
    throw "origin verification failed after setup. Expected $canonicalOrigin but found '$origin'."
}
if (-not (Test-NativeCommandSucceeded { gh repo view $fullName --json nameWithOwner })) {
    throw "Could not verify access to $fullName after repository setup. Run 'gh auth refresh -h github.com -s repo,workflow' and retry."
}

Invoke-Checked { git push --set-upstream origin main } 'Could not push main to GitHub.'

if ($CreateRelease) {
    $workflowPath = Join-Path $PSScriptRoot '.github\workflows\release.yml'
    if (-not (Test-Path $workflowPath)) {
        throw 'The GitHub release workflow is missing: .github\workflows\release.yml'
    }

    # A newly created repository can accept the first push before GitHub has made
    # main the default branch or indexed workflow files. The workflow dispatch API
    # resolves a workflow filename through the default branch, so dispatching
    # immediately can return a misleading 404 even though release.yml was pushed.
    $defaultBranchReady = $false
    for ($attempt = 1; $attempt -le 15; $attempt++) {
        $edited = Test-NativeCommandSucceeded { gh repo edit $fullName --default-branch main }
        if ($edited) {
            $branchResult = Invoke-NativeCommandCapture { gh repo view $fullName --json defaultBranchRef --jq .defaultBranchRef.name }
            if ($branchResult.Succeeded -and $branchResult.Output -eq 'main') {
                $defaultBranchReady = $true
                break
            }
        }
        if ($attempt -eq 1) {
            Write-Host 'Waiting for GitHub to register main as the default branch...' -ForegroundColor Yellow
        }
        Start-Sleep -Seconds 2
    }
    if (-not $defaultBranchReady) {
        throw "GitHub did not register main as the default branch for $fullName. Open the repository settings, confirm the default branch, then retry."
    }

    $workflowReady = $false
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        if (Test-NativeCommandSucceeded { gh workflow view release.yml --repo $fullName }) {
            $workflowReady = $true
            break
        }
        if ($attempt -eq 1) {
            Write-Host 'Waiting for GitHub Actions to index .github/workflows/release.yml...' -ForegroundColor Yellow
        }
        Start-Sleep -Seconds 2
    }
    if (-not $workflowReady) {
        throw "The release workflow did not become visible on GitHub after 60 seconds. Verify .github/workflows/release.yml exists on main and Actions are enabled."
    }

    Write-Host "Queueing GitHub Actions release build for FaceForge BDO $Version..." -ForegroundColor Cyan
    $dispatchQueued = $false
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        if (Test-NativeCommandSucceeded { gh workflow run release.yml --repo $fullName --ref main -f "version=$Version" }) {
            $dispatchQueued = $true
            break
        }
        if ($attempt -eq 1) {
            Write-Host 'GitHub returned a transient workflow-dispatch error. Retrying...' -ForegroundColor Yellow
        }
        Start-Sleep -Seconds 2
    }
    if (-not $dispatchQueued) {
        throw "Could not queue the GitHub Actions release workflow after 10 attempts. Inspect https://github.com/$fullName/actions/workflows/release.yml"
    }

    $headSha = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($headSha)) {
        throw 'Could not determine the commit SHA used for the release workflow.'
    }

    $runId = $null
    for ($attempt = 0; $attempt -lt 20 -and [string]::IsNullOrWhiteSpace($runId); $attempt++) {
        Start-Sleep -Seconds 2
        $previousPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'SilentlyContinue'
            $runJson = & gh run list --repo $fullName --workflow release.yml --event workflow_dispatch --branch main --limit 10 --json databaseId,headSha,createdAt,status 2>$null
            $runListExitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousPreference
            $global:LASTEXITCODE = 0
        }
        if ($runListExitCode -eq 0 -and $runJson) {
            $runs = @($runJson | ConvertFrom-Json)
            $match = $runs | Where-Object { $_.headSha -eq $headSha } | Sort-Object createdAt -Descending | Select-Object -First 1
            if ($null -ne $match) { $runId = [string]$match.databaseId }
        }
    }

    if ([string]::IsNullOrWhiteSpace($runId)) {
        Write-Host 'Release workflow was queued, but its run ID was not visible yet.' -ForegroundColor Yellow
        Write-Host "Track it at: https://github.com/$fullName/actions/workflows/release.yml" -ForegroundColor Yellow
    }
    else {
        Write-Host "Watching GitHub Actions run $runId..." -ForegroundColor Cyan
        & gh run watch $runId --repo $fullName --exit-status
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'Release workflow failed. Printing the failed job log:' -ForegroundColor Red
            $previousPreference = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'SilentlyContinue'
                & gh run view $runId --repo $fullName --log-failed
            }
            finally {
                $ErrorActionPreference = $previousPreference
                $global:LASTEXITCODE = 0
            }
            throw "GitHub Actions release build failed. Inspect: https://github.com/$fullName/actions/runs/$runId"
        }

        $tag = "v$Version"
        if (-not (Test-NativeCommandSucceeded { gh release view $tag --repo $fullName })) {
            throw "The release workflow completed, but release $tag was not found. Inspect: https://github.com/$fullName/actions/runs/$runId"
        }
        Write-Host "Release ready: https://github.com/$fullName/releases/tag/$tag" -ForegroundColor Green
    }
}

Write-Host "Published: https://github.com/$fullName" -ForegroundColor Green
