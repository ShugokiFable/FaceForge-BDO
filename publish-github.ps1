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

$origin = Get-GitRemoteUrl -Name 'origin'
if ([string]::IsNullOrWhiteSpace($origin)) {
    if (Test-NativeCommandSucceeded { gh repo view $fullName }) {
        Invoke-Checked { git remote add origin "https://github.com/$fullName.git" } "Could not connect the existing repository $fullName."
    }
    else {
        $visibilitySwitch = if ($Visibility -eq 'Private') { '--private' } else { '--public' }
        Invoke-Checked { gh repo create $fullName --source . --remote origin $visibilitySwitch } "Could not create $fullName."
    }
    $origin = Get-GitRemoteUrl -Name 'origin'
}

if ([string]::IsNullOrWhiteSpace($origin)) {
    throw 'GitHub repository setup completed without creating an origin remote.'
}
$originSlug = Get-GitHubRepositorySlug -RemoteUrl $origin
if ([string]::IsNullOrWhiteSpace($originSlug)) {
    throw "origin points to '$origin', which is not a supported GitHub repository URL. Expected $fullName."
}
if (-not $originSlug.Equals($fullName, [StringComparison]::OrdinalIgnoreCase)) {
    throw "origin points to '$originSlug', but this publish run expected '$fullName'. Change the repository name or correct the origin remote before retrying."
}

Invoke-Checked { git push --set-upstream origin main } 'Could not push main to GitHub.'

if ($CreateRelease) {
    & (Join-Path $PSScriptRoot 'package.ps1') -Version $Version
    if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }

    $releaseFiles = @(
        Get-ChildItem (Join-Path $PSScriptRoot 'artifacts') -File |
            Where-Object { $_.Extension -in @('.exe', '.zip') -or $_.Name -eq 'SHA256SUMS.txt' } |
            Sort-Object Name |
            ForEach-Object FullName
    )
    if ($releaseFiles.Count -eq 0) { throw 'No release artifacts were produced.' }

    $tag = "v$Version"
    if (Test-NativeCommandSucceeded { gh release view $tag }) {
        Write-Host "Release $tag already exists. Uploading artifacts with overwrite..." -ForegroundColor Yellow
        Invoke-Checked { gh release upload $tag @releaseFiles --clobber } 'Could not update release artifacts.'
    }
    else {
        Invoke-Checked { gh release create $tag @releaseFiles --title "FaceForge BDO $Version" --notes-file CHANGELOG.md } 'Could not create the GitHub release.'
    }
}

Write-Host "Published: https://github.com/$fullName" -ForegroundColor Green
