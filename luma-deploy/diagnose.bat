@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Virtual environment missing. Run start.bat first.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" diagnose.py
pause
