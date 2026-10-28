// Portable acceptance entry; creates its own isolated directory and test credential.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const root = fileURLToPath(new URL('.', import.meta.url))
const index = process.argv.indexOf('--evidence-dir')
const evidenceDir = index < 0 ? null : resolve(process.argv[index + 1])
const { mkdirSync } = await import('node:fs')
if (evidenceDir) mkdirSync(evidenceDir, { recursive: true })
const dir = mkdtempSync(join(tmpdir(), 'TeamSight P0 verify '))
const logs = []
const connections = []
let child
let service
async function launch() {
  child = spawn(process.execPath, [join(root, 'dist/cli.js'), 'serve', '--data-dir', dir, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let buffer = ''
  child.stderr.on('data', chunk => logs.push(chunk.toString()))
  const info = await new Promise((ok, fail) => {
    const timeout = setTimeout(() => { child.kill(); fail(new Error('START_TIMEOUT')) }, 15000)
    child.once('error', e => { clearTimeout(timeout); fail(e) })
    child.once('exit', code => { clearTimeout(timeout); fail(new Error(`START_EXIT_${code}`)) })
    child.stdout.on('data', chunk => {
      buffer += chunk.toString()
      if (!buffer.includes('\n')) return
      try { const ready = JSON.parse(buffer.split('\n')[0]); clearTimeout(timeout); ok(ready) } catch (e) { clearTimeout(timeout); fail(e) }
    })
  })
  service = info
  return info
}
async function connect() {
  const transport = new StreamableHTTPClientTransport(new URL(service.url), { requestInit: { headers: { Authorization: `Bearer ${readFileSync(join(dir, 'access-token'), 'utf8').trim()}` } } })
  const client = new Client({ name: 'teamsight-p0-portable-acceptance', version: '1' })
  await client.connect(transport)
  connections.push({ client, transport })
  return client
}
const call = (client, name, args = {}) => client.callTool({ name, arguments: args })
async function disconnect() {
  for (const c of connections.splice(0)) { await c.transport.terminateSession().catch(() => {}); await c.client.close() }
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const exited = new Promise(ok => child.once('exit', ok))
  const token = readFileSync(join(dir, 'access-token'), 'utf8').trim()
  await fetch(new URL('/_p0/stop', service.url), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) })
  let timer
  try { await Promise.race([exited, new Promise((_, fail) => { timer = setTimeout(() => { child.kill(); fail(new Error('STOP_TIMEOUT')) }, 10000) })]) }
  finally { clearTimeout(timer) }
}
const sentinel = `TEAMSIGHT_P0_SENTINEL_${randomUUID()}`
let cleanupRequired = false
try {
  const first = await launch()
  const [a, b] = await Promise.all([connect(), connect()])
  const [sa, sb] = await Promise.all([call(a, 'teamsight_status'), call(b, 'teamsight_status')])
  assert.equal(sa.structuredContent.pid, sb.structuredContent.pid)
  assert.equal(sa.structuredContent.instanceId, first.instanceId)
  const tools = (await a.listTools()).tools.map(t => t.name)
  assert.ok(tools.includes('teamsight_probe_open_settings'))
  const resource = await a.readResource({ uri: 'ui://teamsight/p0-settings.html' })
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app')
  assert.doesNotMatch(resource.contents[0].text, /<script[^>]*\bsrc=/)
  const saved = await call(a, 'teamsight_probe_save_config', { expectedRevision: 0, patch: { teamName: '中文持久化验证' }, testCredential: sentinel })
  assert.equal(saved.isError, undefined)
  cleanupRequired = true
  assert.equal(saved.structuredContent.revision, 1)
  assert.equal((await call(b, 'teamsight_probe_check_credential', { expected: sentinel })).structuredContent.matches, true)
  const conflict = await call(b, 'teamsight_probe_save_config', { expectedRevision: 0, patch: { teamName: '冲突' } })
  assert.equal(conflict.structuredContent.code, 'REVISION_CONFLICT')
  const failed = await call(b, 'teamsight_probe_save_config', { expectedRevision: 1, patch: { teamName: '失败' }, simulateFailure: true })
  assert.equal(failed.structuredContent.code, 'SAVE_FAILED')
  const render = await call(a, 'teamsight_probe_render')
  const png = Buffer.from(render.content[0].data, 'base64')
  assert.equal(png.readUInt32BE(16), 720)
  assert.equal(png.readUInt32BE(20), 180)
  const publicResults = JSON.stringify([sa, sb, saved, conflict, failed, render, resource])
  assert.ok(!publicResults.includes(sentinel))
  await disconnect(); await stop()
  assert.ok(!readFileSync(join(dir, 'probe.sqlite')).includes(Buffer.from(sentinel)))
  const second = await launch()
  assert.notEqual(first.instanceId, second.instanceId)
  const c = await connect()
  const restored = await call(c, 'teamsight_probe_read_config')
  assert.equal(restored.structuredContent.config.teamName, '中文持久化验证')
  assert.equal(restored.structuredContent.revision, 1)
  assert.equal((await call(c, 'teamsight_probe_check_credential', { expected: sentinel })).structuredContent.matches, true)
  assert.ok(!logs.join('').includes(sentinel))
  assert.equal((await call(c, 'teamsight_probe_clear_credential')).isError, undefined)
  cleanupRequired = false
  const evidence = { ok: true, node: process.versions.node, napi: process.versions.napi, platform: process.platform, arch: process.arch,
    firstInstance: first.instanceId, restartedInstance: second.instanceId, sharedPid: sa.structuredContent.pid,
    tools, resourceBytes: Buffer.byteLength(resource.contents[0].text), pngBytes: png.length,
    sqlitePersistence: true, credentialPersistence: true, outputsAndLogsRedacted: true,
    codexAppsRoundTrip: 'NOT_TESTED_BY_THIS_SCRIPT', hostScheduler: 'NOT_TESTED_BY_THIS_SCRIPT' }
  if (evidenceDir) {
    writeFileSync(join(evidenceDir, 'acceptance.json'), JSON.stringify(evidence, null, 2))
    writeFileSync(join(evidenceDir, 'probe.png'), png)
    writeFileSync(join(evidenceDir, 'probe.svg'), readFileSync(join(dir, 'artifacts/probe.svg')))
    writeFileSync(join(evidenceDir, 'service.log'), logs.join(''))
  }
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  if (cleanupRequired) {
    try { const { openStore } = await import('./dist/storage.js'); const store = openStore(dir); try { store.clearCredential() } finally { store.close() } }
    catch { console.error('TEST_CREDENTIAL_CLEANUP_FAILED: preserve the isolated data directory for cleanup.'); await disconnect(); await stop(); process.exitCode = 1 }
  }
  await disconnect(); await stop()
  if (!process.exitCode) rmSync(dir, { recursive: true, force: true })
}
