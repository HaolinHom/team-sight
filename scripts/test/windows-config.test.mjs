import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parseConfig } from '../installer/config.mjs'
import { verifyWindowsPayload } from '../installer/windows-agent.mjs'

const helper = fileURLToPath(new URL('../installer/windows-config.mjs', import.meta.url))
const run = (...args) => spawnSync(process.execPath, [helper, ...args], { encoding: 'utf8' })
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
test('Windows config helper preserves other connections, hides token and refuses changed connection removal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'teamsight windows config ')), config = join(dir, 'config.toml'), token = 'b'.repeat(64), url = 'http://127.0.0.1:43127/mcp'
  try {
    writeFileSync(config, '# preserved\n[mcp_servers.other]\nurl="https://example.test"\n')
    writeFileSync(join(dir, 'access-token'), token)
    const configured = run('configure', config, dir, url)
    assert.equal(configured.status, 0, configured.stderr); assert.ok(!configured.stdout.includes(token))
    const staged = readFileSync(config + '.teamsight-stage', 'utf8')
    assert.equal(parseConfig(staged).mcp_servers.teamsight.http_headers.Authorization, 'Bearer ' + token)
    assert.equal(parseConfig(staged).mcp_servers.other.url, 'https://example.test')
    assert.ok(readFileSync(config, 'utf8').startsWith('# preserved'))
    rmSync(config + '.teamsight-stage'); writeFileSync(config, staged)
    assert.equal(run('remove', config, dir, 'http://127.0.0.1:49999/mcp').status, 1)
    assert.equal(existsSync(config + '.teamsight-stage'), false)
    assert.equal(run('remove', config, dir, url).status, 0)
    assert.equal(parseConfig(readFileSync(config + '.teamsight-stage', 'utf8')).mcp_servers.teamsight, undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('Windows payload helper normalizes nested keys, rejects extra files and directory links', () => {
  const dir = mkdtempSync(join(tmpdir(), 'teamsight windows payload '))
  try {
    mkdirSync(join(dir, 'nested'))
    const files = { 'versions.json': JSON.stringify({ version: '0.3.4', target: 'win32-x64', variant: 'bundled' }), 'nested/file': 'fixture' }
    for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), value)
    writeFileSync(join(dir, 'checksums.json'), JSON.stringify(Object.fromEntries(Object.entries(files).map(([key, value]) => [key, digest(value)]))))
    assert.equal(run('verify', dir).status, 0)
    writeFileSync(join(dir, 'extra'), 'unexpected'); assert.equal(run('verify', dir).status, 1); rmSync(join(dir, 'extra'))
    symlinkSync(dir, join(dir, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.match(run('verify', dir).stderr, /PAYLOAD_LINK_REFUSED/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('Windows Pages payload pins the checksum list, release, edition and private runtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'teamsight windows pages '))
  try {
    mkdirSync(join(dir, 'runtime'))
    const node = 'fixture runtime', manifest = JSON.stringify({ version: '0.3.10', target: 'win32-x64', variant: 'bundled', runtime: { executableSha256: digest(node) } })
    const sums = JSON.stringify({ 'runtime/node.exe': digest(node), 'versions.json': digest(manifest) })
    writeFileSync(join(dir, 'runtime/node.exe'), node)
    writeFileSync(join(dir, 'versions.json'), manifest)
    writeFileSync(join(dir, 'checksums.json'), sums)
    assert.equal(verifyWindowsPayload(dir, '0.3.10', 'bundled', digest(sums)).version, '0.3.10')
    assert.throws(() => verifyWindowsPayload(dir, '0.3.9', 'bundled', digest(sums)), /PAYLOAD_RELEASE_MISMATCH/)
    assert.throws(() => verifyWindowsPayload(dir, '0.3.10', 'external', digest(sums)), /PAYLOAD_RELEASE_MISMATCH/)
    assert.throws(() => verifyWindowsPayload(dir, '0.3.10', 'bundled', 'a'.repeat(64)), /PAYLOAD_MANIFEST_MISMATCH/)
    writeFileSync(join(dir, 'runtime/node.exe'), 'tampered')
    assert.throws(() => verifyWindowsPayload(dir, '0.3.10', 'bundled', digest(sums)), /PAYLOAD_HASH_MISMATCH/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
