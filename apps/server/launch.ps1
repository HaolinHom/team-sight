$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'NODE_MISSING: install external Node.js 22.23.4 and add it to PATH.'
}
Push-Location $PSScriptRoot
try { & node (Join-Path $PSScriptRoot 'dist/cli.js') @args; exit $LASTEXITCODE }
finally { Pop-Location }
