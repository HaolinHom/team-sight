$ErrorActionPreference = 'Stop'
$runtimeMode = 'external'
$expectedSha256 = 'none'
if ($runtimeMode -eq 'bundled') {
  Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
  Remove-Item Env:NODE_PATH -ErrorAction SilentlyContinue
  $nodePath = Join-Path $PSScriptRoot 'runtime/node.exe'
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw 'NODE_BUNDLED_MISSING: restore the bundled runtime from the release archive.'
  }
  if ((Get-FileHash -LiteralPath $nodePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedSha256) {
    throw 'NODE_BUNDLED_CORRUPT: restore the bundled runtime from the release archive.'
  }
} else {
  $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { throw 'NODE_MISSING: install Node.js 22.14+ (<23), or use the bundled edition.' }
  $nodePath = @($nodeCommand)[0].Source
}
Push-Location $PSScriptRoot
try {
  & $nodePath --input-type=module -e "import {runtimeProblem} from './dist/runtime.js'; const p=runtimeProblem(); if(p){console.error(p);process.exit(1)}"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & $nodePath @args
  exit $LASTEXITCODE
} finally { Pop-Location }
