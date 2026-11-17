$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
    if (!(Test-Path -LiteralPath $python)) { throw 'Create .venv and install backend/requirements-build.txt first.' }
    Push-Location frontend
    try {
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE) { throw 'npm ci failed' }
        & npm.cmd run build
        if ($LASTEXITCODE) { throw 'Frontend build failed' }
    } finally { Pop-Location }
    & $python -m PyInstaller --noconfirm Monitor.spec
    if ($LASTEXITCODE) { throw 'Packaging failed' }
    $version = & $python -c "import sys; sys.path.insert(0,'backend'); import config; print(config.VERSION)"
    $output = Join-Path $PSScriptRoot "dist\Monitor-v$version-windows-x64.exe"
    Copy-Item -LiteralPath 'dist\Monitor.exe' -Destination $output -Force
    Get-FileHash -Algorithm SHA256 -LiteralPath $output
} finally { Pop-Location }
