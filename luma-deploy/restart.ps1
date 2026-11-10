# Stop only a verified Python process running this project's absolute run.py.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
$taskRunPath = Join-Path $PSScriptRoot 'run.py'
if (-not (Test-Path -LiteralPath $taskPython)) {
    Write-Output 'No virtual environment yet. Run start.bat.'
    exit 1
}
$taskPortText = & $taskPython -c "from pathlib import Path; import os; from dotenv import load_dotenv; load_dotenv(Path('.env'), encoding='utf-8-sig'); print(int(os.getenv('PORT', '8001')))"
if ($LASTEXITCODE -ne 0) { exit 1 }
$taskPort = [int]$taskPortText
if ($taskPort -lt 1 -or $taskPort -gt 65535) { throw 'Invalid PORT in .env.' }
$taskPattern = '^\s*TCP\s+(?:127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]):' + $taskPort + '\s+\S+\s+LISTENING\s+(\d+)\s*$'
$taskOwners = @(& netstat.exe -ano -p tcp | ForEach-Object {
    if ($_ -match $taskPattern) { [int]$Matches[1] }
} | Sort-Object -Unique)
foreach ($taskProcessId in $taskOwners) {
    $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$taskProcessId"
    $taskCommand = $taskProcess.CommandLine
    $taskExecutable = $taskProcess.ExecutablePath
    $taskIsProject = $taskCommand -and $taskCommand.IndexOf(('"' + $taskRunPath + '"'), [StringComparison]::OrdinalIgnoreCase) -ge 0
    if (-not $taskProcess -or -not $taskIsProject -or (Split-Path -Leaf $taskExecutable) -notin @('python.exe', 'pythonw.exe')) {
        Write-Output "Port $taskPort is used by PID $taskProcessId. Cannot verify that it belongs to this project."
        Write-Output 'Close the old Luma server with Ctrl+C, then run start.bat.'
        exit 1
    }
    Stop-Process -Id $taskProcessId -ErrorAction Stop
    Write-Output "Stopped Luma server PID $taskProcessId."
}
if (-not $taskOwners.Count) { Write-Output 'No previous Luma server is listening.' }
exit 0
