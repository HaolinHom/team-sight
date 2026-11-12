import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, cp, chmod, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { packageTargets, cachedDownload, sha256, withStaging, publishFiles, fileHashes } from '../package-mcp-lib.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'teamsight package test '))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
test('targets accept defaults and all, reject unsupported or excess arguments', () => {
  assert.deepEqual(packageTargets([], 'darwin-arm64'), ['darwin-arm64'])
  assert.deepEqual(packageTargets(['all']), ['darwin-arm64', 'win32-x64'])
  for (const args of [['linux-x64'], ['all', '--force'], ['../escape']]) assert.throws(() => packageTargets(args), /INVALID_TARGET/)
})
test('runtime cache verifies downloads and cached bytes; corruption never falls through', async t => {
  const dir = await fixture(t), path = join(dir, 'node.tgz'), bytes = Buffer.from('pinned fixture'), digest = sha256(bytes)
  let calls = 0
  const fetcher = async () => { calls++; return { ok: true, arrayBuffer: async () => bytes } }
  await cachedDownload(path, 'https://example.invalid/node', digest, fetcher)
  assert.deepEqual(await cachedDownload(path, 'https://example.invalid/node', digest, fetcher), bytes)
  assert.equal(calls, 1)
  await writeFile(path, 'corrupt')
  await assert.rejects(cachedDownload(path, 'https://example.invalid/node', digest, fetcher), /CACHE_HASH_MISMATCH/)
  assert.equal(calls, 1)
  await rm(path)
  await assert.rejects(cachedDownload(path, 'https://example.invalid/node', '0'.repeat(64), fetcher), /ARCHIVE_HASH_MISMATCH/)
  await assert.rejects(readFile(path), { code: 'ENOENT' })
  await assert.rejects(cachedDownload(path, 'https://example.invalid/node', digest, async () => ({ ok: false, status: 503 })), /HTTP 503/)
})
test('staging cleans failed preparation without touching earlier releases', async t => {
  const dir = await fixture(t)
  await writeFile(join(dir, 'previous'), 'keep')
  await assert.rejects(withStaging(dir, async stage => { await writeFile(join(stage, 'partial'), 'partial'); throw Error('fixture failure') }), /fixture failure/)
  assert.deepEqual(await readdir(dir), ['previous'])
})
test('publication refuses existing files and rolls back only its own partial outputs', async t => {
  const dir = await fixture(t), from = join(dir, 'staged'), to = join(dir, 'release')
  await writeFile(from, 'new'); await writeFile(to, 'old')
  await assert.rejects(publishFiles([{ from, to }]), /OUTPUT_EXISTS/)
  assert.equal(await readFile(to, 'utf8'), 'old')
  await rm(to)
  await assert.rejects(publishFiles([{ from, to }, { from: join(dir, 'missing'), to: join(dir, 'second') }]), { code: 'ENOENT' })
  await assert.rejects(readFile(to), { code: 'ENOENT' })
})
test('file hashes reject symbolic links', async t => {
  const dir = await fixture(t)
  await writeFile(join(dir, 'file'), 'value')
  assert.equal((await fileHashes(dir)).file, sha256('value'))
  await symlink(process.platform === 'win32' ? dir : join(dir, 'file'), join(dir, 'link'), process.platform === 'win32' ? 'junction' : 'file')
  await assert.rejects(fileHashes(dir), /UNEXPECTED_SYMLINK/)
})
test('POSIX launcher pins runtime, sanitizes options, forwards args and exit codes', { skip: process.platform !== 'darwin' }, async t => {
  const dir = await fixture(t)
  await mkdir(join(dir, 'runtime')); await mkdir(join(dir, 'dist')); await mkdir(join(dir, 'wrong path'))
  await cp(process.execPath, join(dir, 'runtime/node')); await chmod(join(dir, 'runtime/node'), 0o755)
  await cp(join(root, 'apps/server/dist/runtime.js'), join(dir, 'dist/runtime.js'))
  await writeFile(join(dir, 'package.json'), '{"type":"module"}')
  await writeFile(join(dir, 'probe.mjs'), 'console.log(JSON.stringify({execPath:process.execPath,args:process.argv.slice(2),options:process.env.NODE_OPTIONS,path:process.env.NODE_PATH}));process.exit(17)')
  const hash = sha256(await readFile(join(dir, 'runtime/node')))
  const source = await readFile(join(root, 'apps/server/run-node.sh'), 'utf8')
  await writeFile(join(dir, 'run-node.sh'), source.replace('MODE=external', 'MODE=bundled').replace('EXPECTED_SHA256=none', 'EXPECTED_SHA256=' + hash))
  await writeFile(join(dir, 'wrong path/node'), '#!/bin/sh\nexit 99\n'); await chmod(join(dir, 'wrong path/node'), 0o755)
  const env = { ...process.env, PATH: join(dir, 'wrong path'), NODE_OPTIONS: '--invalid-node-option', NODE_PATH: '/must/be/cleared' }
  const invoke = () => spawnSync('/bin/sh', [join(dir, 'run-node.sh'), 'probe.mjs', 'a b', "quote'argument"], { cwd: '/', env, encoding: 'utf8' })
  const result = invoke()
  assert.equal(result.status, 17, result.stderr)
  const value = JSON.parse(result.stdout)
  assert.equal(value.execPath, await realpath(join(dir, 'runtime/node'))); assert.deepEqual(value.args, ['a b', "quote'argument"])
  assert.equal(value.options, undefined); assert.equal(value.path, undefined)
  await writeFile(join(dir, 'runtime/node'), 'corrupted')
  assert.match(invoke().stderr, /NODE_BUNDLED_CORRUPT/)
  await rm(join(dir, 'runtime/node'))
  assert.match(invoke().stderr, /NODE_BUNDLED_MISSING/)
  await writeFile(join(dir, 'run-node.sh'), source)
  const missing = spawnSync('/bin/sh', [join(dir, 'run-node.sh'), 'probe.mjs'], { env: { ...process.env, PATH: '' }, encoding: 'utf8' })
  assert.equal(missing.status, 1); assert.match(missing.stderr, /NODE_MISSING/)
})
