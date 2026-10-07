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
    $existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -match $pattern } | Select-Object -First 1
    if ($existing) {
        $serviceProcess = Get-Process -Id $existing.ProcessId
        Write-Host '墨音已在运行，无需重复启动。'
    } else {
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        if ([int]((& $node --version).TrimStart('v').Split('.')[0]) -lt 22) {
            throw '请先安装 Node.js 22 或更高版本。'
        }
        if (-not (Test-Path -LiteralPath (Join-Path $env:MOYIN_ROOT 'node_modules'))) {
            throw '缺少依赖，请先在项目目录运行 npm ci。'
        }
        $log = Join-Path $env:MOYIN_ROOT 'data\server-start.log'
        $errorLog = Join-Path $env:MOYIN_ROOT 'data\server-start-error.log'
        $serviceProcess = Start-Process -FilePath $node -ArgumentList ('"{0}"' -f $entry) -WorkingDirectory $env:MOYIN_ROOT -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errorLog -PassThru
    }
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $serviceProcess.Refresh()
        if ($serviceProcess.HasExited) {
            if ($errorLog) { Get-Content -LiteralPath $errorLog -Encoding UTF8 | Write-Host }
            throw '启动失败，请查看 data\server-start-error.log；如端口被旧启动窗口占用，请先关闭旧服务。'
        }
        $listener = Get-NetTCPConnection -State Listen -OwningProcess $serviceProcess.Id -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener) {
            $url = 'http://localhost:' + $listener.LocalPort
            try {
                $health = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $listener.LocalPort + '/api/health') -TimeoutSec 2
                if ($health.ok) {
                    Write-Host "墨音已启动：$url（PID $($serviceProcess.Id)）"
                    exit 0
                }
            } catch {}
        }
        Start-Sleep -Milliseconds 500
    }
    throw '服务尚未就绪，请查看 data 下的 server-start 日志。'
} catch {
    Write-Host ('错误：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
