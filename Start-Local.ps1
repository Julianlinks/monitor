param([ValidateRange(1, 65535)][int]$Port = 8000)
$ErrorActionPreference = 'Stop'
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
$index = Join-Path $PSScriptRoot 'frontend\dist\index.html'
if (!(Test-Path -LiteralPath $python) -or !(Test-Path -LiteralPath $index)) {
    throw '请先安装 Python 后端依赖，在 frontend 目录执行 npm ci 和 npm run build。'
}

function Get-LocalHealth([int]$servicePort) {
    try { Invoke-RestMethod "http://127.0.0.1:$servicePort/api/health" -TimeoutSec 2 }
    catch { return $null }
}

$defaultPort = !$PSBoundParameters.ContainsKey('Port')
$site = Get-LocalHealth $Port
if ($defaultPort -and $site.version -and $site.version -ne '2.0.0') {
    $Port = 8766
    $site = Get-LocalHealth $Port
}
$address = "http://127.0.0.1:$Port"
if ($site) {
    if ($site.version -ne '2.0.0') { throw "端口 $Port 已有其他服务。请通过 -Port 选择另一个端口。" }
    Write-Output "$address/#/diagnostics"
    return
}
Push-Location (Join-Path $PSScriptRoot 'backend')
try {
    $env:PYTHONUTF8 = '1'
    if ($defaultPort -and $Port -eq 8766 -and !$env:DB_PATH) {
        $env:DB_PATH = Join-Path (Get-Location) 'power_dashboard-v2.db'
    }
    Write-Output "$address/#/diagnostics"
    & $python -m uvicorn main:app --host 127.0.0.1 --port $Port
    exit $LASTEXITCODE
} finally { Pop-Location }
