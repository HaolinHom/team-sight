$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'run-node.ps1') (Join-Path $PSScriptRoot 'dist/cli.js') @args
exit $LASTEXITCODE
