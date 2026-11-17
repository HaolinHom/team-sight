import { test } from 'node:test'
import assert from 'node:assert/strict'
import { configureCodex, deleteConfigPath, parseConfig } from '../installer/config.mjs'
import { paths, verifyPayload, digest } from '../installer/main.mjs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const token = 'a'.repeat(64), url = 'http://127.0.0.1:43127/mcp'
const cases = [
  '',
  '# keep this\nmodel = "sample"\nnumber = 9007199254740993\n[mcp_servers.other]\nurl="https://example.test"\n',
  '# url = "a trap"\nnote = """\n[mcp_servers.teamsight]\nurl=\"not a real table\"\n"""\n',
  '[mcp_servers.teamsight]\ncommand="node" # old command\nargs=["old.js"]\nbearer_token_env_var="OLD"\ndefault_tools_approval_mode="prompt"\n[mcp_servers.teamsight.tools.write]\napproval_mode="prompt"\n[mcp_servers.other]\nurl="https://example.test"\n',
  '[mcp_servers.teamsight.http_headers]\nauthorization="old"\n"X-Custom"="keep"\n[mcp_servers.teamsight.env_http_headers]\nAuthorization="OLD_ENV"\n"X-Region"="REGION"\n',
  '[mcp_servers]\nteamsight={url="old", http_headers={Authorization="old", "X-Custom"="keep"}, enabled_tools=["teamsight_status"]}\nother={url="https://example.test"}\n',
  'mcp_servers.teamsight.url="old"\nmcp_servers.teamsight.http_headers={authorization="old"}\n',
  '["mcp_servers"."teamsight"]\nurl="old"\n[mcp_servers.teamsight.oauth]\nclient_id="obsolete"\n',
  'mcp_servers={teamsight={url="old", http_headers={Authorization="old"}}, other={url="https://example.test"}}\n',
]
for (const [i, source] of cases.entries()) test('Codex TOML structure, comments and policies: ' + i, () => {
  const before = parseConfig(source), output = configureCodex(source, url, token), after = parseConfig(output)
  assert.equal(after.mcp_servers.teamsight.url, url)
  assert.equal(after.mcp_servers.teamsight.http_headers.Authorization, 'Bearer ' + token)
  assert.equal(after.mcp_servers.teamsight.bearer_token_env_var, undefined)
  assert.equal(after.mcp_servers.teamsight.command, undefined)
  assert.equal(after.mcp_servers.teamsight.oauth, undefined)
  if (before.mcp_servers?.teamsight?.tools) assert.deepEqual(after.mcp_servers.teamsight.tools, before.mcp_servers.teamsight.tools)
  if (before.mcp_servers?.other) assert.deepEqual(after.mcp_servers.other, before.mcp_servers.other)
  for (const line of source.split('\n').filter(s => s.startsWith('#'))) assert.ok(output.includes(line))
  assert.deepEqual(parseConfig(configureCodex(output, url, token)), after)
  const removed = parseConfig(deleteConfigPath(output, ['mcp_servers', 'teamsight']))
  assert.equal(removed.mcp_servers?.teamsight, undefined)
  assert.deepEqual(removed.mcp_servers?.other, before.mcp_servers?.other)
})
test('malformed TOML never echoes config/credential text', () => {
  assert.throws(() => configureCodex('broken=["private-token"', url, token), /^Error: CODEX_CONFIG_INVALID$/)
  assert.throws(() => configureCodex('mcp_servers="private-token"', url, token), /^Error: CODEX_CONFIG_INVALID$/)
})
test('test service paths cannot collide with production label or Codex home', { skip: process.platform !== 'darwin' }, () => {
  const p = paths('/tmp/teamsight-installer-test-sample', '/tmp/teamsight-installer-test-sample/codex', true, 44001)
  assert.match(p.label, /^cn\.teamsight\.mcp\.test\./)
  assert.ok(p.plist.startsWith('/tmp/teamsight-installer-test-sample/'))
})
test('payload verification normalizes doubled separators and rejects tampering/symlinks', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'teamsight-payload-test-'))
  try {
    const files = { 'README.md': 'fixture', 'versions.json': '{"version":"0.3.4"}' }
    for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(join(dir, name), bytes)
    fs.writeFileSync(join(dir, 'checksums.json'), JSON.stringify(Object.fromEntries(Object.entries(files).map(([key, bytes]) => [key, digest(bytes)]))))
    assert.equal(verifyPayload(dir.replace('/teamsight-', '//teamsight-')).version, '0.3.4')
    fs.writeFileSync(join(dir, 'README.md'), 'changed')
    assert.throws(() => verifyPayload(dir), /PAYLOAD_HASH_MISMATCH/)
    fs.writeFileSync(join(dir, 'README.md'), 'fixture')
    fs.symlinkSync(process.platform === 'win32' ? dir : 'README.md', join(dir, 'link'), process.platform === 'win32' ? 'junction' : 'file')
    assert.throws(() => verifyPayload(dir), /PAYLOAD_SYMLINK_OR_SPECIAL_FILE/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
