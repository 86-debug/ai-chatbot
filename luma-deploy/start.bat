@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
  if errorlevel 1 goto failed
)
".venv\Scripts\python.exe" -c "import fastapi, uvicorn, httpx, dotenv" >nul 2>&1
if errorlevel 1 (
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 goto failed
)
if not exist ".env" copy ".env.example" ".env" >nul
echo Luma - Open http://127.0.0.1:8001 in your browser.
".venv\Scripts\python.exe" "%~dp0run.py"
pause
exit /b 0
:failed
echo Setup failed. Check Python 3.10+ and your network, then try again.
pause
exit /b 1
