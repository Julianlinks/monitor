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
    $staging = Join-Path $PSScriptRoot 'build\desktop-dist'
    & $python -m PyInstaller --noconfirm --distpath $staging Monitor.spec
    if ($LASTEXITCODE) { throw 'Packaging failed' }
    $version = & $python -c "import sys; sys.path.insert(0,'backend'); import config; print(config.VERSION)"
    $dist = New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot 'dist') -Force
    $output = Join-Path $dist.FullName "Monitor-v$version-windows-x64.exe"
    Copy-Item -LiteralPath (Join-Path $staging 'Monitor.exe') -Destination $output -Force
    Get-FileHash -Algorithm SHA256 -LiteralPath $output
} finally { Pop-Location }
