[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Owner = 'ShugokiFable'
$Repository = 'FaceForge-BDO'
$Version = '0.4.0'
$FullName = "$Owner/$Repository"
$Tag = "v$Version"
$Root = $PSScriptRoot
$ArtifactDir = Join-Path $Root 'artifacts'
$CanonicalOrigin = "https://github.com/$FullName.git"

function Require-Command([string]$Name, [string]$Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name was not found. $Hint"
    }
}

function Invoke-Checked([scriptblock]$Command, [string]$Failure) {
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw $Failure
    }
}

Require-Command 'git' 'Install Git for Windows, then reopen this folder.'
Require-Command 'gh' 'Install GitHub CLI, then run: gh auth login'
Invoke-Checked { gh auth status } 'GitHub CLI is not authenticated. Run: gh auth login'

$Assets = @(
    (Join-Path $ArtifactDir "FaceForge BDO $Version - STANDALONE.exe"),
    (Join-Path $ArtifactDir "FaceForge BDO $Version - SOURCE.zip"),
    (Join-Path $ArtifactDir "FaceForge BDO $Version - RELEASE.zip"),
    (Join-Path $ArtifactDir 'SHA256SUMS.txt')
)
foreach ($Asset in $Assets) {
    if (-not (Test-Path -LiteralPath $Asset -PathType Leaf)) {
        throw "Required release asset is missing: $Asset"
    }
}

$TempRoot = Join-Path ([IO.Path]::GetTempPath()) "FaceForge-BDO-Publish-$([guid]::NewGuid().ToString('N'))"
$RepoRoot = Join-Path $TempRoot 'repo'
New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null

try {
    $RepositoryExists = $false
    & gh repo view $FullName --json nameWithOwner *> $null
    if ($LASTEXITCODE -eq 0) {
        $RepositoryExists = $true
    }
    $global:LASTEXITCODE = 0

    if ($RepositoryExists) {
        Write-Host "Cloning $FullName..." -ForegroundColor Cyan
        Invoke-Checked {
            gh repo clone $FullName $RepoRoot -- --branch main
        } "Could not clone $FullName. Verify that main exists and your GitHub login has repository access."
    }
    else {
        Write-Host "Creating $FullName..." -ForegroundColor Yellow
        Invoke-Checked { gh repo create $FullName --public } "Could not create $FullName."
        New-Item -ItemType Directory -Path $RepoRoot -Force | Out-Null
        Set-Location $RepoRoot
        Invoke-Checked { git init } 'Could not initialize the temporary Git repository.'
        Invoke-Checked { git remote add origin $CanonicalOrigin } 'Could not add the GitHub origin remote.'
    }

    Write-Host 'Copying the complete 0.4.0 source into the repository...' -ForegroundColor Cyan
    & robocopy $Root $RepoRoot /MIR /R:2 /W:1 /XD .git artifacts /XF '*.exe' '*.zip' '*.sha256' | Out-Host
    $RoboCopyExit = $LASTEXITCODE
    $global:LASTEXITCODE = 0
    if ($RoboCopyExit -gt 7) {
        throw "Source copy failed with Robocopy exit code $RoboCopyExit."
    }

    Set-Location $RepoRoot
    Invoke-Checked { git branch -M main } 'Could not set the main branch.'

    $GitName = (& git config --get user.name 2>$null)
    $GitNameExit = $LASTEXITCODE
    $global:LASTEXITCODE = 0
    if ($GitNameExit -ne 0 -or [string]::IsNullOrWhiteSpace(($GitName -join ''))) {
        Invoke-Checked { git config user.name $Owner } 'Could not configure the Git author name.'
    }
    $GitEmail = (& git config --get user.email 2>$null)
    $GitEmailExit = $LASTEXITCODE
    $global:LASTEXITCODE = 0
    if ($GitEmailExit -ne 0 -or [string]::IsNullOrWhiteSpace(($GitEmail -join ''))) {
        Invoke-Checked { git config user.email "$Owner@users.noreply.github.com" } 'Could not configure the Git author email.'
    }

    Invoke-Checked { git add --all } 'Could not stage the 0.4.0 source.'
    $Changes = (& git status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Git status.' }
    if ($Changes) {
        Invoke-Checked { git commit -m "Release FaceForge BDO $Version" } 'Could not commit the 0.4.0 source.'
    }
    else {
        Write-Host 'The repository already contains the same 0.4.0 source.' -ForegroundColor Yellow
    }

    Invoke-Checked { git push --set-upstream origin main } 'Could not push main to GitHub.'
    $HeadSHA = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($HeadSHA)) {
        throw 'Could not resolve the published commit SHA.'
    }

    Write-Host "Replacing GitHub release $Tag with the verified local artifacts..." -ForegroundColor Cyan
    & gh release view $Tag --repo $FullName *> $null
    $ReleaseExists = $LASTEXITCODE -eq 0
    $global:LASTEXITCODE = 0
    if ($ReleaseExists) {
        Invoke-Checked { gh release delete $Tag --repo $FullName --yes --cleanup-tag } "Could not remove the existing $Tag release."
    }

    & git tag -d $Tag *> $null
    $global:LASTEXITCODE = 0
    & git push origin ":refs/tags/$Tag" *> $null
    $global:LASTEXITCODE = 0

    Invoke-Checked { git tag -f $Tag $HeadSHA } "Could not create tag $Tag."
    Invoke-Checked { git push origin "refs/tags/$Tag" --force } "Could not push tag $Tag."

    $ReleaseArguments = @(
        'release', 'create', $Tag,
        '--repo', $FullName,
        '--title', "FaceForge BDO $Version",
        '--notes-file', (Join-Path $RepoRoot 'CHANGELOG.md')
    ) + $Assets
    & gh @ReleaseArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Could not create GitHub release $Tag."
    }

    Invoke-Checked { gh release view $Tag --repo $FullName } "Release $Tag was not found after upload."

    Write-Host ''
    Write-Host 'PUBLISH COMPLETE' -ForegroundColor Green
    Write-Host "Repository: https://github.com/$FullName" -ForegroundColor Green
    Write-Host "Release:    https://github.com/$FullName/releases/tag/$Tag" -ForegroundColor Green
}
finally {
    Set-Location $Root
    if (Test-Path $TempRoot) {
        Remove-Item $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
