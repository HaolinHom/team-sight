// Release acceptance on isolated copies, never the installed service or real TAPD.
import assert from 'node:assert/strict'
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { verifyWindowsPackages } from './verify-windows-packages.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const releases = resolve(process.argv[2] ?? join(root, 'artifacts/releases/0.3.3'))
const evidence = resolve(process.argv[3] ?? join(root, '.local/validation/mcp033/packages'))
await mkdir(evidence, { recursive: true })
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const results = [], extracted = new Map()
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 90_000, ...options })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout.trim()
}
async function hashes(directory) {
  const output = {}
  async function walk(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false, 'symbolic link: ' + entry.name)
      const key = prefix + entry.name, path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path, key + '/')
      else output[key] = sha(await readFile(path))
    }
  }
  await walk(directory)
  return output
}
function peX64(bytes) {
  assert.equal(bytes.toString('ascii', 0, 2), 'MZ')
  const pe = bytes.readUInt32LE(0x3c)
  assert.equal(bytes.readUInt32LE(pe), 0x00004550)
  assert.equal(bytes.readUInt16LE(pe + 4), 0x8664)
}
const selectedTarget = process.argv[4]
assert.ok(!selectedTarget || ['darwin-arm64', 'win32-x64'].includes(selectedTarget), 'unsupported acceptance target')
const sums = (await readFile(join(releases, selectedTarget ? `SHA256SUMS-${selectedTarget}.txt` : 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/)
assert.equal(sums.length, selectedTarget ? 2 : 4)
for (const line of sums) {
  const [expected, archiveName] = line.split('  ')
  assert.match(archiveName, /^teamsight-mcp-0\.3\.3-(darwin-arm64|win32-x64)-(bundled|external)\.(zip|tar\.gz)$/)
  const archive = join(releases, archiveName)
  assert.equal(sha(await readFile(archive)), expected)
  const target = archiveName.includes('darwin-arm64') ? 'darwin-arm64' : 'win32-x64'
  const variant = archiveName.includes('-bundled.') ? 'bundled' : 'external'
  const directoryName = `teamsight-mcp-${target}-${variant}`
  const unpack = join(evidence, `extracted 中文 ${target} ${variant}`)
  await mkdir(unpack) // Refuse to overwrite acceptance evidence.
  command('tar', ['-xf', archive, '-C', unpack])
  const directory = join(unpack, directoryName)
  const manifest = JSON.parse(await readFile(join(directory, 'versions.json'), 'utf8'))
  assert.equal(manifest.version, '0.3.3'); assert.equal(manifest.target, target); assert.equal(manifest.variant, variant)
  assert.equal(manifest.runtimeBundled, variant === 'bundled'); assert.equal(manifest.validatedNode, null)
  const expectedFiles = JSON.parse(await readFile(join(directory, 'checksums.json'), 'utf8'))
  const actualFiles = await hashes(directory)
  delete actualFiles['checksums.json']
  assert.deepEqual(actualFiles, expectedFiles)
  const publishedFiles = await hashes(join(releases, directoryName)); delete publishedFiles['checksums.json']
  assert.deepEqual(actualFiles, publishedFiles)
  if (variant === 'bundled') {
    assert.equal(manifest.runtime.version, '22.23.4')
    assert.equal(actualFiles[manifest.runtime.executable], manifest.runtime.executableSha256)
    assert.deepEqual((await readdir(join(directory, 'runtime'))).sort(), ['LICENSE', target === 'win32-x64' ? 'node.exe' : 'node'].sort())
  } else await assert.rejects(access(join(directory, 'runtime')), { code: 'ENOENT' })
  if (target === 'win32-x64') {
    for (const name of Object.keys(actualFiles).filter(name => name.endsWith('.node') || name.endsWith('/node.exe'))) peX64(await readFile(join(directory, name)))
  }
  extracted.set(`${target}-${variant}`, { directory, manifest, hashes: actualFiles })
  results.push({ target, variant, archive: archiveName, archiveSha256: expected, archiveBytes: (await readFile(archive)).length, files: Object.keys(actualFiles).length,
    archiveVerified: true, nativeExecution: target === 'win32-x64' ? 'pending on Windows' : 'pending', windowsPeX64: target === 'win32-x64' })
}
for (const target of selectedTarget ? [selectedTarget] : ['darwin-arm64', 'win32-x64']) {
  const a = extracted.get(target + '-bundled'), b = extracted.get(target + '-external')
  assert.deepEqual(a.manifest.sourceHashes, b.manifest.sourceHashes)
  assert.deepEqual(a.manifest.dependencies, b.manifest.dependencies)
  assert.equal(a.manifest.commonPayloadSha256, b.manifest.commonPayloadSha256)
  const common = files => Object.fromEntries(Object.entries(files).filter(([key]) => !key.startsWith('runtime/') && !['versions.json', 'README.md', 'run-node.sh', 'run-node.ps1'].includes(key)))
  assert.deepEqual(common(a.hashes), common(b.hashes))
}

if (process.platform === 'darwin' && process.arch === 'arm64' && extracted.has('darwin-arm64-bundled')) {
  const sharedData = join(evidence, 'shared isolated data')
  const seed = join(evidence, 'data-fixture.mjs')
  await writeFile(seed, `import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';const {openStore}=await import(pathToFileURL(process.argv[2]+'/dist/storage.js'));const store=openStore(process.argv[3]);try{let s=store.readSettings();if(s.revision===0)s=store.saveSettings({expectedRevision:0,patch:{teamName:'双版本隔离验收'}});assert.equal(s.settings.teamName,'双版本隔离验收');assert.equal(s.revision,1);console.log(JSON.stringify({revision:s.revision,teamName:s.settings.teamName,dbVersion:store.db.pragma('user_version',{simple:true})}))}finally{store.close()}`)
  for (const variant of ['bundled', 'external']) {
    const directory = extracted.get('darwin-arm64-' + variant).directory
    const launch = join(directory, 'launch.sh'), runner = join(directory, 'run-node.sh')
    const env = variant === 'bundled' ? { ...process.env, PATH: '', NODE_OPTIONS: '--invalid-option', NODE_PATH: '/must/be/cleared' } : process.env
    const runtime = JSON.parse(command(runner, ['-p', 'JSON.stringify({node:process.versions.node,execPath:process.execPath})'], { env }))
    assert.equal(runtime.node, '22.23.4')
    if (variant === 'bundled') assert.equal(runtime.execPath, join(directory, 'runtime/node'))
    const doctor = JSON.parse(command(launch, ['doctor'], { env }))
    assert.equal(doctor.ok, true); assert.equal(doctor.keyringMatches, true); assert.ok(doctor.pngBytes > 0)
    const acceptance = JSON.parse(command(runner, ['verify-mcp.mjs', '--evidence-dir', join(evidence, variant + '-mcp')], { env }))
    assert.equal(acceptance.version, '0.3.3'); assert.equal(acceptance.remoteTapdPosts, 0)
    command(runner, [seed, directory, sharedData], { env })
    const service = spawn(launch, ['serve', '--data-dir', sharedData, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', errorOutput = '', exited = false
    service.stdout.on('data', bytes => { output += bytes }); service.stderr.on('data', bytes => { errorOutput += bytes }); service.on('exit', () => { exited = true })
    try {
      for (let i = 0; i < 300 && !output.includes('"event":"ready"') && !exited; i++) await delay(100)
      assert.ok(output.includes('"event":"ready"'), errorOutput || output)
      const status = JSON.parse(command(launch, ['status', '--data-dir', sharedData], { env }))
      assert.equal(status.version, '0.3.3'); assert.equal(status.revision, 1); assert.equal(status.node, '22.23.4')
      const scheduledStatus = JSON.parse(command(runner, ['status-mcp.mjs', sharedData], { env }))
      assert.equal(scheduledStatus.instanceId, status.instanceId)
      command(launch, ['stop', '--data-dir', sharedData], { env })
      for (let i = 0; i < 100 && !exited; i++) await delay(50)
      assert.equal(exited, true)
    } finally { if (!exited) service.kill('SIGTERM') }
    command(runner, [seed, directory, sharedData], { env })
    const row = results.find(row => row.target === 'darwin-arm64' && row.variant === variant)
    Object.assign(row, { nativeExecution: 'passed', actualNode: runtime.node, executablePath: runtime.execPath, doctor, mcp: acceptance, sharedDataRevision: 1, serveStatusStop: true, scheduledStatus: true })
  }
  const bundled = extracted.get('darwin-arm64-bundled').directory, external = extracted.get('darwin-arm64-external').directory
  const wrongBin = join(evidence, 'wrong node path'); await mkdir(wrongBin)
  await writeFile(join(wrongBin, 'node'), '#!/bin/sh\nexit 99\n', { mode: 0o755 })
  assert.equal(command(join(bundled, 'run-node.sh'), ['-p', 'process.versions.node'], { env: { ...process.env, PATH: wrongBin } }), '22.23.4')
  const missing = spawnSync(join(external, 'launch.sh'), ['doctor'], { env: { ...process.env, PATH: '' }, encoding: 'utf8' })
  assert.equal(missing.status, 1); assert.match(missing.stderr, /NODE_MISSING/)
  const node20 = join(process.env.HOME, '.nvm/versions/node/v20.19.5/bin')
  await access(join(node20, 'node'))
  const unsupported = spawnSync(join(external, 'launch.sh'), ['doctor'], { env: { ...process.env, PATH: node20 }, encoding: 'utf8' })
  assert.equal(unsupported.status, 1); assert.match(unsupported.stderr, /NODE_UNSUPPORTED/)
  // Fault injection only on a separate copied package; published and accepted copies stay intact.
  const faulty = join(evidence, 'faulty bundled'); await cp(bundled, faulty, { recursive: true })
  const executable = join(faulty, 'runtime/node')
  await writeFile(executable, 'corrupted')
  const corrupt = spawnSync(join(faulty, 'launch.sh'), ['doctor'], { env: { ...process.env, PATH: wrongBin }, encoding: 'utf8' })
  assert.equal(corrupt.status, 1); assert.match(corrupt.stderr, /NODE_BUNDLED_CORRUPT/)
  await rm(executable)
  const absent = spawnSync(join(faulty, 'launch.sh'), ['doctor'], { encoding: 'utf8' })
  assert.equal(absent.status, 1); assert.match(absent.stderr, /NODE_BUNDLED_MISSING/)
  await rm(faulty, { recursive: true })
}
const windowsTested = process.platform === 'win32' && process.arch === 'x64' && extracted.has('win32-x64-bundled')
if (windowsTested) await verifyWindowsPackages({ extracted, evidence, results })
const nativeTested = windowsTested || process.platform === 'darwin' && process.arch === 'arm64' && extracted.has('darwin-arm64-bundled')
const report = { ok: true, version: '0.3.3', packages: results, sharedPayloadsMatch: true, runtimeIsolationAndDiagnostics: nativeTested ? 'passed' : 'not tested', windowsNativeExecution: windowsTested ? 'passed' : 'not tested; requires Windows x64', codexNativeApps: 'not tested', remoteTapdWrites: 0 }
await writeFile(join(evidence, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
