@echo off
setlocal
chcp 65001 >nul
set "MOYIN_ROOT=%~dp0"
set "MOYIN_SCRIPT=%~f0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$text = Get-Content -LiteralPath $env:MOYIN_SCRIPT -Raw -Encoding UTF8; & ([scriptblock]::Create(($text -split ':POWERSHELL\r?\n', 2)[1]))"
set "MOYIN_EXIT=%ERRORLEVEL%"
if not "%MOYIN_EXIT%"=="0" pause
exit /b %MOYIN_EXIT%
:POWERSHELL
$ErrorActionPreference = 'Stop'
try {
    $entry = Join-Path $env:MOYIN_ROOT 'server\index.js'
    $pattern = '(?:^|\s)"?' + [regex]::Escape($entry) + '"?(?:\s|$)'
    $services = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -match $pattern })
    if ($services.Count -eq 0) {
        Write-Host '未发现由快捷启动运行的nana服务；旧启动窗口中的服务请按 Ctrl+C 关闭。'
        exit 0
    }
    foreach ($service in $services) {
        $process = Get-Process -Id $service.ProcessId -ErrorAction SilentlyContinue
        if ($process) {
            Stop-Process -InputObject $process -Force
            if (-not $process.WaitForExit(10000)) { throw '服务未能在 10 秒内退出。' }
            Write-Host "nana已关闭（PID $($service.ProcessId)）。"
        }
    }
} catch {
    Write-Host ('错误：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
