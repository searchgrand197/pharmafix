# Safe client update: backup DB, pull code only, migrate, optional restart.
# Never overwrites db.sqlite3 / wal / shm from git.
param(
    [switch]$SkipPull,
    [switch]$SkipMigrate,
    [switch]$Restart,
    [string]$Branch = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Stop-CureviceBackend {
    Write-Step "Stopping local Django/runserver processes (best effort)"
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -and (
                $_.CommandLine -match 'manage\.py\s+runserver' -or
                $_.CommandLine -match 'gunicorn.*config\.wsgi'
            )
        } |
        ForEach-Object {
            try {
                Write-Host "Stopping PID $($_.ProcessId)"
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            } catch {}
        }
}

function Backup-Sqlite {
    $db = Join-Path $Root "db.sqlite3"
    if (-not (Test-Path $db)) {
        Write-Host "No db.sqlite3 in repo root; skipping backup."
        return $null
    }

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupDir = Join-Path $Root "backups\db-$stamp"
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

    Write-Step "Backing up SQLite to $backupDir"
    Copy-Item $db (Join-Path $backupDir "db.sqlite3") -Force
    foreach ($suffix in @("-wal", "-shm")) {
        $side = "$db$suffix"
        if (Test-Path $side) {
            Copy-Item $side (Join-Path $backupDir "db.sqlite3$suffix") -Force
        }
    }
    return $backupDir
}

function Invoke-SqliteMaintenance {
    $db = Join-Path $Root "db.sqlite3"
    if (-not (Test-Path $db)) { return }

    $python = $env:CUREVICE_VENV
    if ($python) {
        $python = Join-Path $python "Scripts\python.exe"
    }
    if (-not $python -or -not (Test-Path $python)) {
        $pyCmd = Get-Command python -ErrorAction SilentlyContinue
        if ($pyCmd) { $python = $pyCmd.Source }
    }
    if (-not $python) {
        Write-Host "Python not found; skipping WAL checkpoint / integrity check."
        return
    }

    Write-Step "SQLite wal_checkpoint + integrity_check"
    $script = @"
import sqlite3
from pathlib import Path
db = Path(r'$db')
con = sqlite3.connect(str(db))
try:
    con.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    row = con.execute('PRAGMA integrity_check').fetchone()
    print(row[0] if row else 'unknown')
finally:
    con.close()
"@
    $result = & $python -c $script
    Write-Host "integrity_check: $result"
    if ($result -ne "ok") {
        throw "SQLite integrity_check failed ($result). Restore from backups/ before migrating."
    }
}

function Update-CodeOnly {
    if ($SkipPull) {
        Write-Host "SkipPull set; not fetching code."
        return
    }
    if (-not (Test-Path (Join-Path $Root ".git"))) {
        Write-Host "Not a git checkout; copy code manually (never overwrite db.sqlite3*)."
        return
    }

    Write-Step "Updating code only (git pull --ff-only; never overwrite db.sqlite3*)"
    if ($Branch) {
        git fetch origin $Branch
        git merge --ff-only "origin/$Branch"
    } else {
        git pull --ff-only
    }
}

function Invoke-Migrate {
    if ($SkipMigrate) {
        Write-Host "SkipMigrate set."
        return
    }
    Write-Step "Applying migrations"
    & (Join-Path $PSScriptRoot "ensure_venv.cmd")
    if ($LASTEXITCODE -ne 0) { throw "ensure_venv failed" }
    $venvPython = Join-Path $env:CUREVICE_VENV "Scripts\python.exe"
    & $venvPython manage.py migrate
    if ($LASTEXITCODE -ne 0) { throw "migrate failed" }
}

Stop-CureviceBackend
$backup = Backup-Sqlite
Invoke-SqliteMaintenance
Update-CodeOnly
Invoke-Migrate

if ($Restart) {
    Write-Step "Restart requested — start via curevice.bat menu option 1"
}

Write-Host ""
Write-Host "Safe update finished." -ForegroundColor Green
if ($backup) {
    Write-Host "DB backup: $backup"
}
Write-Host "Remember: never git reset --hard over a live db.sqlite3."
