// Windows native acceptance uses the real PowerShell entrypoints and isolated data.
import assert from 'node:assert/strict'
import { cp, rm, writeFile, access } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export async function verifyWindowsPackages({ extracted, evidence, results }) {
  let powershell = process.env.TEAMSIGHT_POWERSHELL || join(process.env.ProgramFiles, 'PowerShell/7/pwsh.exe')
  try { await access(powershell) } catch { powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') }
  const invoke = (script, args = [], env = process.env) => spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-File', script, ...args], { env, encoding: 'utf8', timeout: 120_000, windowsHide: true })
  const command = (script, args, env) => {
    const result = invoke(script, args, env)
    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    return result.stdout.trim()
  }
  const sharedData = join(evidence, '共享 中文 data')
  const probe = join(evidence, 'runtime probe.mjs'), seed = join(evidence, 'data fixture.mjs')
  await writeFile(probe, 'console.log(JSON.stringify({node:process.versions.node,execPath:process.execPath,args:process.argv.slice(2),options:process.env.NODE_OPTIONS,path:process.env.NODE_PATH}));process.exit(Number(process.env.TEAMSIGHT_PROBE_EXIT||0))')
  await writeFile(seed, `import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';const {openStore}=await import(pathToFileURL(process.argv[2]+'/dist/storage.js'));const s=openStore(process.argv[3]);try{let v=s.readSettings();if(v.revision===0)v=s.saveSettings({expectedRevision:0,patch:{teamName:'Windows 双版本验收'}});assert.equal(v.settings.teamName,'Windows 双版本验收');assert.equal(v.revision,1);assert.equal(s.db.pragma('user_version',{simple:true}),4)}finally{s.close()}`)
  const cleanPath = { ...process.env }
  // Windows environment keys are case insensitive; avoid retaining a second Path.
  for (const key of Object.keys(cleanPath)) if (key.toLowerCase() === 'path') delete cleanPath[key]
  const isolated = { ...cleanPath, PATH: '', NODE_OPTIONS: '--invalid-option', NODE_PATH: 'must-be-cleared' }
  for (const variant of ['bundled', 'external']) {
    const directory = extracted.get('win32-x64-' + variant).directory
    const launch = join(directory, 'launch.ps1'), runner = join(directory, 'run-node.ps1')
    const env = variant === 'bundled' ? isolated : process.env
    const runtime = JSON.parse(command(runner, [probe, 'a b', "quote'argument", '中文'], env))
    assert.equal(runtime.node, '22.23.4')
    assert.deepEqual(runtime.args, ['a b', "quote'argument", '中文'])
    if (variant === 'bundled') {
      assert.equal(runtime.execPath.toLowerCase(), join(directory, 'runtime/node.exe').toLowerCase())
      assert.equal(runtime.options, undefined); assert.equal(runtime.path, undefined)
    }
    assert.equal(invoke(runner, [probe], { ...env, TEAMSIGHT_PROBE_EXIT: '17' }).status, 17)
    const doctor = JSON.parse(command(launch, ['doctor'], env))
    assert.equal(doctor.ok, true); assert.equal(doctor.keyringMatches, true); assert.ok(doctor.pngBytes > 0)
    const mcp = JSON.parse(command(runner, ['verify-mcp.mjs', '--evidence-dir', join(evidence, variant + '-mcp')], env))
    assert.equal(mcp.tools, 37); assert.equal(mcp.remoteTapdPosts, 0)
    command(runner, [seed, directory, sharedData], env)
    const service = spawn(powershell, ['-NoProfile', '-NonInteractive', '-File', launch, 'serve', '--data-dir', sharedData, '--port', '0'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', errors = '', exited = false
    service.stdout.on('data', data => { output += data }); service.stderr.on('data', data => { errors += data }); service.on('exit', () => { exited = true })
    try {
      for (let i = 0; i < 300 && !output.includes('"event":"ready"') && !exited; i++) await delay(100)
      assert.ok(output.includes('"event":"ready"'), errors || output)
      const status = JSON.parse(command(launch, ['status', '--data-dir', sharedData], env))
      assert.equal(status.revision, 1); assert.equal(status.node, '22.23.4')
      assert.equal(JSON.parse(command(runner, ['status-mcp.mjs', sharedData], env)).instanceId, status.instanceId)
      command(launch, ['stop', '--data-dir', sharedData], env)
      for (let i = 0; i < 100 && !exited; i++) await delay(100)
      assert.equal(exited, true)
    } finally {
      if (!exited) { invoke(launch, ['stop', '--data-dir', sharedData], env); await delay(1000) }
    }
    command(runner, [seed, directory, sharedData], env)
    Object.assign(results.find(row => row.target === 'win32-x64' && row.variant === variant), { nativeExecution: 'passed', powershell, actualNode: runtime.node, executablePath: runtime.execPath, doctor, mcp, sharedDataRevision: 1, serveStatusStop: true, scheduledStatus: true, argumentAndExitCode: true })
  }
  const external = extracted.get('win32-x64-external').directory, bundled = extracted.get('win32-x64-bundled').directory
  const missing = invoke(join(external, 'launch.ps1'), ['doctor'], { ...cleanPath, PATH: '' })
  assert.notEqual(missing.status, 0); assert.match(missing.stderr, /NODE_MISSING/)
  const oldNode = process.env.TEAMSIGHT_TEST_OLD_NODE
  assert.ok(oldNode, 'set TEAMSIGHT_TEST_OLD_NODE to an installed incompatible Node directory')
  const unsupported = invoke(join(external, 'launch.ps1'), ['doctor'], { ...cleanPath, PATH: oldNode })
  assert.notEqual(unsupported.status, 0); assert.match(unsupported.stderr, /NODE_UNSUPPORTED/)
  const faulty = join(evidence, 'faulty bundled')
  await cp(bundled, faulty, { recursive: true })
  try {
    const executable = join(faulty, 'runtime/node.exe')
    await writeFile(executable, 'corrupted')
    const corrupt = invoke(join(faulty, 'launch.ps1'), ['doctor'], isolated)
    assert.notEqual(corrupt.status, 0); assert.match(corrupt.stderr, /NODE_BUNDLED_CORRUPT/)
    await rm(executable)
    const absent = invoke(join(faulty, 'launch.ps1'), ['doctor'], isolated)
    assert.notEqual(absent.status, 0); assert.match(absent.stderr, /NODE_BUNDLED_MISSING/)
  } finally { await rm(faulty, { recursive: true, force: true }) }
}
