import { runtimeProblem } from './runtime.js'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const problem = runtimeProblem()
if (problem) { console.error(problem); process.exit(1) }
const [command = 'help', ...args] = process.argv.slice(2)
function option(key: string, fallback: string) {
  const index = args.indexOf(key)
  if (index < 0) return fallback
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('INVALID_ARGUMENT')
  return args[index + 1]
}
async function main() {
  const dataDir = resolve(option('--data-dir', process.env.TEAMSIGHT_P0_DATA_DIR ?? '.local/teamsight-p0'))
  if (command === 'serve') {
    const port = Number(option('--port', '43127'))
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('INVALID_PORT')
    const { startServer } = await import('./server.js')
    const service = await startServer({ dataDir, port, uiPath: process.env.TEAMSIGHT_P0_UI_PATH })
    console.log(JSON.stringify({ event: 'ready', ...service.info }))
  } else if (command === 'status' || command === 'stop') {
    const info = JSON.parse(readFileSync(join(dataDir, 'instance.json'), 'utf8'))
    const token = readFileSync(join(dataDir, 'access-token'), 'utf8').trim()
    const base = new URL(info.url)
    if (base.hostname !== '127.0.0.1' || base.protocol !== 'http:') throw new Error('INVALID_INSTANCE_URL')
    const status = await fetch(new URL('/health', base), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }).then(r => r.json()) as { instanceId: string }
    if (status.instanceId !== info.instanceId) throw new Error('INSTANCE_ID_MISMATCH')
    console.log(JSON.stringify(command === 'status' ? status : await fetch(new URL('/_p0/stop', base), { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())))
  } else if (command === 'doctor') {
    const dir = mkdtempSync(join(tmpdir(), 'teamsight-p0-doctor-'))
    let cleanup: (() => void) | undefined
    try {
      const { openStore } = await import('./storage.js')
      const { renderProbe } = await import('./render.js')
      const store = openStore(dir)
      cleanup = () => { try { store.clearCredential() } finally { store.close() } }
      const sentinel = `TEAMSIGHT_P0_SENTINEL_${randomUUID()}`
      const saved = store.save({ expectedRevision: 0, patch: { teamName: '原生验证' }, testCredential: sentinel })
      if (!store.verifyCredential(sentinel).matches) throw new Error('KEYRING_MISMATCH')
      const png = renderProbe(dir)
      console.log(JSON.stringify({ ok: true, node: process.versions.node, napi: process.versions.napi, platform: process.platform, arch: process.arch, sqlite: store.db.prepare('SELECT sqlite_version() AS version').get(), revision: saved.revision, keyringMatches: true, pngBytes: png.png.length, pngSha256: png.sha256 }))
    } finally { cleanup?.(); rmSync(dir, { recursive: true, force: true }) }
  } else {
    console.log('TeamSight P0: serve [--data-dir PATH] [--port PORT] | status | stop | doctor. Requires external Node.js 22.14.0+ (<23). No TAPD operations.')
  }
}
main().catch(error => {
  // Do not print native error objects: they can contain secret arguments.
  const known = /^(NODE_|INVALID_|INSTANCE_|KEYRING_|SCHEMA_|STORAGE_|PORT_)/.test(error?.message ?? '')
  console.error(known ? error.message : 'P0_START_OR_NATIVE_FAILED: check Node.js 22, platform-native modules, isolated directory permissions and Apps resource path.')
  process.exitCode = 1
})
