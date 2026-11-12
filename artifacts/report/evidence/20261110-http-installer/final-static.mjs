import * as fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import assert from 'node:assert/strict'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const release = JSON.parse(fs.readFileSync('.local/validation/http-installer/release.json'))
const script = fs.readFileSync('scripts/install.sh')
assert.equal(hash(script), release.sha256)
const blob = spawnSync('git', ['show', release.commit + ':scripts/install.sh'], { maxBuffer: 2 * 1024 * 1024 })
assert.equal(blob.status, 0); assert.deepEqual(blob.stdout, script)
const guide = fs.readFileSync('docs/install/macos-agent-install.md', 'utf8')
assert.ok(guide.includes(release.url) && guide.includes(release.sha256))
assert.doesNotMatch(guide, /<INSTALLER|<COMMIT|<SHA256|curl[^\n]*\|\s*(sh|bash)/)
for (const line of fs.readFileSync('artifacts/releases/0.3.3/SHA256SUMS.txt', 'utf8').trim().split('\n')) {
  const [expected, name] = line.split(/\s+/)
  assert.equal(hash(fs.readFileSync('artifacts/releases/0.3.3/' + name)), expected)
}
const files = ['README.md', 'docs/validation/teamsight-mcp-platforms.md', 'docs/install/macos-agent-install.md',
  'artifacts/report/20261110_macos-http-agent-install_测试报告.md', 'artifacts/knowledge/20261110_macos-http-agent-install.md',
  'scripts/install.sh', 'scripts/build-installer.mjs', 'scripts/prepare-installer-release.mjs', 'scripts/verify-http-installer.mjs',
  ...fs.readdirSync('scripts/installer').map(name => 'scripts/installer/' + name), 'scripts/test/installer.test.mjs']
let links = 0
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  assert.doesNotMatch(text, /[\t ]+$/m, file)
  if (!file.endsWith('.md')) continue
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0]
    if (!target || /^(https?:|mailto:)/.test(target)) continue
    assert.ok(fs.existsSync(resolve(dirname(file), target)), file + ' -> ' + target); links++
  }
}
assert.equal(JSON.parse(fs.readFileSync('package.json')).version, '0.3.3')
assert.equal(JSON.parse(fs.readFileSync('apps/server/package.json')).version, '0.3.3')
console.log(JSON.stringify({ ok: true, snapshotMatchesGeneratedScript: true, sealedArchivesUnchanged: 4, localMarkdownLinks: links, appVersion: '0.3.3' }))
