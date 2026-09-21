@echo off
REM Activate the stable external Curevice venv in this shell.
cd /d "%~dp0"
call "%~dp0scripts\ensure_venv.cmd"
if errorlevel 1 (
  echo Failed to prepare venv.
  exit /b 1
)
call "%CUREVICE_VENV%\Scripts\activate.bat"
echo.
echo Activated: %CUREVICE_VENV%
echo Use: python manage.py runserver
