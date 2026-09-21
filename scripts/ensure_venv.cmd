@echo off
REM Prepare the stable external venv and put it on PATH for this cmd session.
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure_venv.ps1" %*
if errorlevel 1 exit /b 1

REM Sibling folder outside the git repo — immune to merges/checkouts.
set "CUREVICE_VENV=%~dp0..\..\curevice-venv"
REM Normalize path
for %%I in ("%CUREVICE_VENV%") do set "CUREVICE_VENV=%%~fI"
set "VIRTUAL_ENV=%CUREVICE_VENV%"
set "PATH=%CUREVICE_VENV%\Scripts;%PATH%"
exit /b 0
