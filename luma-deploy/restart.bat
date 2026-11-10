@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -File "%~dp0restart.ps1"
if errorlevel 1 (
  echo Restart stopped. You can close the old server with Ctrl+C, then run start.bat.
  pause
  exit /b 1
)
call "%~dp0start.bat"
