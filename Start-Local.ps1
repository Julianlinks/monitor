$ErrorActionPreference = 'Stop'
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
$index = Join-Path $PSScriptRoot 'frontend\dist\index.html'
if (!(Test-Path -LiteralPath $python) -or !(Test-Path -LiteralPath $index)) {
    throw 'Install backend requirements and run npm run build in frontend first.'
}
$address = 'http://127.0.0.1:8000'
try { $site = Invoke-RestMethod "$address/api/health" -TimeoutSec 2 } catch { $site = $null }
if ($site -and $site.status -eq 'ok') {
    $null = Invoke-RestMethod "$address/api/replay/datasets" -TimeoutSec 3
    Write-Output "$address/#/replay"
    return
}
Push-Location (Join-Path $PSScriptRoot 'backend')
try {
    $env:PYTHONUTF8 = '1'
    Write-Output "$address/#/replay"
    & $python -m uvicorn main:app --host 127.0.0.1 --port 8000
    exit $LASTEXITCODE
} finally { Pop-Location }
