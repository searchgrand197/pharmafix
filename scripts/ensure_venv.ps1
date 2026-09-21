# Stable Curevice Python environment.
# Keeps the venv OUTSIDE the git repo so merges/checkouts cannot corrupt it.
# Also creates a .venv junction so `.\.venv\Scripts\Activate.ps1` still works.
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$VenvDir = Join-Path (Split-Path $RepoRoot -Parent) "curevice-venv"
$PythonCandidates = @(
    "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "C:\Python313\python.exe",
    "C:\Python312\python.exe"
)

function Find-Python {
    foreach ($candidate in $PythonCandidates) {
        if (Test-Path $candidate) { return $candidate }
    }
    $fromPath = Get-Command python -ErrorAction SilentlyContinue
    if ($fromPath) { return $fromPath.Source }
    throw "Python 3.12+ was not found. Install Python 3.13 and retry."
}

function Test-VenvHealthy {
    param([string]$Dir)
    $cfg = Join-Path $Dir "pyvenv.cfg"
    $py = Join-Path $Dir "Scripts\python.exe"
    if (-not (Test-Path $cfg)) { return $false }
    if (-not (Test-Path $py)) { return $false }
    try {
        & $py -c "import django, PIL" 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Test-IsJunction {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $false }
    $item = Get-Item $Path -Force
    return [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

# Remove broken in-repo .venv (real folder). Keep/repair junction to external venv.
$InRepoVenv = Join-Path $RepoRoot ".venv"
if (Test-Path $InRepoVenv) {
    if (-not (Test-IsJunction $InRepoVenv)) {
        Write-Host "Removing broken in-repo .venv folder..."
        try {
            Remove-Item -Recurse -Force $InRepoVenv -ErrorAction Stop
        } catch {
            Write-Host "WARNING: could not fully delete $InRepoVenv (file lock). Close runserver and retry."
        }
    }
}

$needsCreate = $Force -or -not (Test-VenvHealthy $VenvDir)
if ($needsCreate) {
    $python = Find-Python
    Write-Host "Creating stable venv at: $VenvDir"
    Write-Host "Using Python: $python"
    if (Test-Path $VenvDir) {
        Remove-Item -Recurse -Force $VenvDir -ErrorAction SilentlyContinue
    }
    & $python -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) { throw "Failed to create venv." }

    $venvPython = Join-Path $VenvDir "Scripts\python.exe"
    & $venvPython -m pip install --upgrade pip
    & $venvPython -m pip install -r (Join-Path $RepoRoot "requirements.txt")
    if ($LASTEXITCODE -ne 0) { throw "pip install failed." }
    Write-Host "Venv ready."
} else {
    Write-Host "Stable venv OK: $VenvDir"
}

# Convenience junction so Activate.ps1 / (.venv) prompt still work.
if (-not (Test-Path $InRepoVenv)) {
    Write-Host "Linking .venv -> $VenvDir"
    cmd /c "mklink /J `"$InRepoVenv`" `"$VenvDir`"" | Out-Null
} elseif (-not (Test-IsJunction $InRepoVenv)) {
    Write-Host "WARNING: .venv exists but is not a junction; external venv is still $VenvDir"
}

# Keep .git/hooks in sync so merges auto-repair the env.
$GitHooks = Join-Path $RepoRoot ".git\hooks"
$ProjectHooks = Join-Path $RepoRoot ".githooks"
if ((Test-Path $GitHooks) -and (Test-Path $ProjectHooks)) {
    foreach ($hookName in @("post-merge", "post-checkout")) {
        $src = Join-Path $ProjectHooks $hookName
        $dst = Join-Path $GitHooks $hookName
        if (Test-Path $src) {
            Copy-Item -Force $src $dst -ErrorAction SilentlyContinue
        }
    }
}

$env:CUREVICE_VENV = $VenvDir
$env:VIRTUAL_ENV = $VenvDir
$env:PATH = "$(Join-Path $VenvDir 'Scripts');$env:PATH"
Write-Output $VenvDir
