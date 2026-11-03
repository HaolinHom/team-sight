export function runtimeProblem(version = process.versions.node, napi = process.versions.napi) {
  const [major, minor] = version.split('.').map(Number)
  if (major !== 22 || minor < 14 || Number(napi) < 10) {
    return 'NODE_UNSUPPORTED: TeamSight MCP requires external Node.js 22.14.0+ (<23), Node-API 10+. Validated baseline: 22.23.4.'
  }
  return null
}
