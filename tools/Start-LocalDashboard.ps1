$ErrorActionPreference = 'Stop'
$outputBase = Split-Path -Parent $PSScriptRoot
$dashboardPath = Join-Path $outputBase 'dashboard'
$hostScript = Join-Path $dashboardPath 'scripts\local-service-host.mjs'
$listener = Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue
if ($listener) {
    Write-Host 'Port 5173 is already listening. Open http://127.0.0.1:5173/ ; no second service was started.'
    exit 0
}
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$logDirectory = Join-Path $outputBase 'diagnostics'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutLog = Join-Path $logDirectory ("local-dashboard-$stamp.log")
$stderrLog = Join-Path $logDirectory ("local-dashboard-$stamp.error.log")
$hostProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @('--max-old-space-size=64',('"' + $hostScript + '"')) -WorkingDirectory $dashboardPath -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    $hostProcess.Refresh()
    if ($hostProcess.HasExited) { throw "Local startup failed. Inspect $stderrLog" }
    try {
        $health = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/api/health' -UseBasicParsing -TimeoutSec 2
        if ($health.StatusCode -eq 200) {
            Write-Host "Local dashboard ready: http://127.0.0.1:5173/ ; host PID $($hostProcess.Id)"
            exit 0
        }
    } catch { }
}
throw "Local startup not ready. Inspect $stdoutLog and $stderrLog"
