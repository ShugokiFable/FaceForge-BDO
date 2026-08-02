function Invoke-Checked {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command,
        [Parameter(Mandatory = $true)]
        [string]$Failure
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw $Failure
    }
}

function Test-NativeCommandSucceeded {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )

    # Windows PowerShell 5.1 converts native stderr into PowerShell error records.
    # Expected lookup failures must therefore run with a temporary non-terminating
    # preference, otherwise $ErrorActionPreference = 'Stop' aborts the publisher.
    # Capture the result and then clear LASTEXITCODE. Leaving an expected failure in
    # LASTEXITCODE makes powershell.exe report exit code 1 even when the script passed.
    $previousPreference = $ErrorActionPreference
    $succeeded = $false
    try {
        $ErrorActionPreference = 'SilentlyContinue'
        & $Command *> $null
        $succeeded = $LASTEXITCODE -eq 0
    }
    finally {
        $ErrorActionPreference = $previousPreference
        $global:LASTEXITCODE = 0
    }

    return $succeeded
}

function Get-GitRemoteUrl {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $remoteNames = @(& git remote)
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not list Git remotes.'
    }

    if ($remoteNames -notcontains $Name) {
        return $null
    }

    $remoteUrl = @(& git remote get-url $Name)
    if ($LASTEXITCODE -ne 0) {
        throw "Could not read the Git remote '$Name'."
    }

    $value = ($remoteUrl -join "`n").Trim()
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $null
    }
    return $value
}

function Get-GitHubRepositorySlug {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$RemoteUrl
    )

    $value = $RemoteUrl.Trim().TrimEnd('/')
    $patterns = @(
        '^https?://github\.com/(?<slug>[^/]+/[^/]+)$',
        '^git@github\.com:(?<slug>[^/]+/[^/]+)$',
        '^ssh://git@github\.com/(?<slug>[^/]+/[^/]+)$'
    )

    foreach ($pattern in $patterns) {
        if ($value -match $pattern) {
            $slug = $Matches['slug']
            if ($slug.EndsWith('.git', [StringComparison]::OrdinalIgnoreCase)) {
                $slug = $slug.Substring(0, $slug.Length - 4)
            }
            return $slug
        }
    }

    return $null
}
