// Build once per platform, then produce portable bundled and external editions.
import { chmod, cp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { resolve, join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { NODE_VERSION, packageTargets, prepareRuntime, fileHashes, requireAbsent, withStaging, publishFiles, run, sha256 } from './package-mcp-lib.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const targets = packageTargets(process.argv.slice(2))
const source = join(root, 'apps/server')
const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
const releases = resolve(root, 'artifacts/releases', pkg.version)
const variants = ['bundled', 'external']
const names = targets.flatMap(target => variants.map(variant => ({ target, variant, name: 'teamsight-mcp-' + target + '-' + variant,
  archive: 'teamsight-mcp-' + pkg.version + '-' + target + '-' + variant + (target === 'win32-x64' ? '.zip' : '.tar.gz') })))
const checksumName = targets.length === 2 ? 'SHA256SUMS.txt' : 'SHA256SUMS-' + targets[0] + '.txt'
await mkdir(releases, { recursive: true })
// Reserve publication before any download; concurrent writers must not overwrite each other.
await requireAbsent([...names.flatMap(item => [join(releases, item.name), join(releases, item.archive)]), join(releases, checksumName)])
const lock = join(releases, '.package-lock')
await mkdir(lock)
try {
await withStaging(releases, async staging => {
  const sourceHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
  const sourceFiles = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'README.md', 'scripts/package-mcp.mjs', 'scripts/package-mcp-lib.mjs', 'scripts/verify-mcp-packages.mjs', 'scripts/test/package-mcp.test.mjs', 'docs/validation/teamsight-mcp-platforms.md', 'docs/TeamSight-MCP-能力与使用说明.md']
  async function listFiles(dir) {
    const items = []
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist'].includes(ent.name)) continue
      const p = join(dir, ent.name)
      if (ent.isDirectory()) items.push(...await listFiles(p)); else items.push(p)
    }
    return items
  }
  sourceFiles.push(...(await listFiles(join(root, 'apps'))).map(p => relative(root, p)), ...(await listFiles(join(root, 'packages'))).map(p => relative(root, p)))
  const sourceHashes = {}
  for (const name of sourceFiles.sort()) sourceHashes[name] = sha256(await readFile(join(root, name)))
  const publications = [], archiveHashes = [], results = []
  for (const target of targets) {
    const output = join(staging, 'base-' + target)
    await mkdir(output)
const rootVersions = new Map()
const copied = []
async function locate(name, from) {
  for (let at = from; ; at = dirname(at)) {
    try { return await realpath(join(at, 'node_modules', name)) } catch {}
    if (dirname(at) === at) return null
  }
}
async function copyPackage(name, from, optional = false, ancestors = new Set()) {
  const src = await locate(name, from)
  if (!src) { if (optional) return; throw new Error(`MISSING_PRODUCTION_DEPENDENCY: ${name}`) }
  if (ancestors.has(src)) return
  const meta = JSON.parse(await readFile(join(src, 'package.json'), 'utf8'))
  if ((meta.os && !meta.os.includes(target.split('-')[0])) || (meta.cpu && !meta.cpu.includes(target.split('-')[1]))) return
  if (rootVersions.get(name) === meta.version) return
  if (rootVersions.has(name)) throw new Error(`CONFLICTING_PACKAGE_VERSION: ${name}; use a nested package layout before release`)
  rootVersions.set(name, meta.version)
  const dest = join(output, 'node_modules', name)
  await cp(src, dest, { recursive: true, dereference: true, filter: p => relative(src, p).split(sep)[0] !== 'node_modules' })
  const next = new Set([...ancestors, src])
  copied.push({ name, version: meta.version })
  for (const dependency of Object.keys(meta.dependencies ?? {})) await copyPackage(dependency, src, false, next)
  for (const dependency of Object.keys(meta.optionalDependencies ?? {})) await copyPackage(dependency, src, true, next)
  for (const dependency of Object.keys(meta.peerDependencies ?? {})) await copyPackage(dependency, src, !!meta.peerDependenciesMeta?.[dependency]?.optional, next)
}
for (const name of Object.keys(pkg.dependencies)) await copyPackage(name, source)
// macOS installations omit Windows optional packages. Prepare them at build time,
// verify npm integrity, and include them without executing installation scripts.
if (target === 'win32-x64') {
  for (const [name, version] of [['@napi-rs/keyring-win32-x64-msvc', '2.1.2'], ['@resvg/resvg-js-win32-x64-msvc', '2.6.2']]) {
    const cacheRoot=process.env.TEAMSIGHT_MCP_NATIVE_CACHE
    if(cacheRoot){
      const manifestText=await readFile(join(cacheRoot,'versions.json'),'utf8'),manifest=JSON.parse(manifestText),hashes=JSON.parse(await readFile(join(cacheRoot,'checksums.json'),'utf8'))
      const previous=manifest.dependencies.find(entry=>entry.name===name&&entry.version===version&&entry.integrity)
      if(manifest.target!==target||!previous)throw new Error('NATIVE_CACHE_VERSION_MISMATCH: '+name)
      const prefix='node_modules/'+name+'/',sourceDir=join(cacheRoot,'node_modules',name)
      const entries=[]
      async function validateCache(dir){
        for(const item of await readdir(dir,{withFileTypes:true})){
          const path=join(dir,item.name)
          if(item.isSymbolicLink())throw new Error('NATIVE_CACHE_SYMLINK')
          if(item.isDirectory())await validateCache(path)
          else{const key=relative(cacheRoot,path).split(sep).join('/');if(createHash('sha256').update(await readFile(path)).digest('hex')!==hashes[key])throw new Error('NATIVE_CACHE_HASH_MISMATCH: '+key);entries.push(key)}
        }
      }
      await validateCache(sourceDir)
      if(!entries.length||Object.keys(hashes).filter(key=>key.startsWith(prefix)).length!==entries.length)throw new Error('NATIVE_CACHE_FILE_SET_MISMATCH')
      const cachedMeta=JSON.parse(await readFile(join(sourceDir,'package.json'),'utf8'))
      if(cachedMeta.name!==name||cachedMeta.version!==version)throw new Error('NATIVE_CACHE_PACKAGE_MISMATCH')
      await cp(sourceDir,join(output,'node_modules',name),{recursive:true})
      copied.push({...previous,cacheManifestSha256:createHash('sha256').update(manifestText).digest('hex')})
      continue
    }
    const response = await fetch(`https://registry.npmjs.org/${name}/${version}`)
    if (!response.ok) throw new Error(`REGISTRY_METADATA_FAILED: ${name}`)
    const meta = await response.json()
    const archiveResponse = await fetch(meta.dist.tarball)
    if (!archiveResponse.ok) throw new Error(`REGISTRY_DOWNLOAD_FAILED: ${name}`)
    const bytes = Buffer.from(await archiveResponse.arrayBuffer())
    const [algorithm, expected] = meta.dist.integrity.split('-')
    if (createHash(algorithm).update(bytes).digest('base64') !== expected) throw new Error(`INTEGRITY_MISMATCH: ${name}`)
    const temp = mkdtempSync(join(tmpdir(), 'teamsight-mcp-native-'))
    try {
      const archive = join(temp, 'native.tgz')
      await writeFile(archive, bytes)
      const dest = join(output, 'node_modules', name)
      await mkdir(dest, { recursive: true })
      const extraction = spawnSync('tar', ['-xzf', archive, '--strip-components=1', '-C', dest], { stdio: 'inherit' })
      if (extraction.status !== 0) throw new Error(`NATIVE_EXTRACTION_FAILED: ${name}`)
      copied.push({ name, version, integrity: meta.dist.integrity })
    } finally { await rm(temp, { recursive: true, force: true }) }
  }
}
const prebuilds = join(output, 'node_modules/better-sqlite3/prebuilds')
for (const name of await readdir(prebuilds)) if (name !== `${target}.node`) await rm(join(prebuilds, name))
await cp(join(source, 'dist'), join(output, 'dist'), { recursive: true })
await cp(join(root, 'apps/mcp-ui/dist'), join(output, 'ui'), { recursive: true })
for (const name of ['verify-mcp.mjs', 'status-mcp.mjs', 'launch.sh', 'launch.ps1', 'run-node.sh', 'run-node.ps1']) await cp(join(source, name), join(output, name))
await mkdir(join(output, 'docs/validation'), {recursive:true})
await cp(join(root, 'docs/validation/teamsight-mcp-platforms.md'), join(output, 'docs/validation/teamsight-mcp-platforms.md'))
await cp(join(root, 'docs/TeamSight-MCP-能力与使用说明.md'), join(output, 'docs/TeamSight-MCP-能力与使用说明.md'))

    const baseHashes = await fileHashes(output)
    const runtime = await prepareRuntime(root, target, staging)
    for (const item of names.filter(item => item.target === target)) {
      const destination = join(staging, item.name)
      await cp(output, destination, { recursive: true })
      const bundled = item.variant === 'bundled'
      if (bundled) await cp(runtime.directory, join(destination, 'runtime'), { recursive: true })
      for (const script of ['run-node.sh', 'run-node.ps1']) {
        let text = await readFile(join(destination, script), 'utf8')
        if (bundled) text = text.replace(script.endsWith('.sh') ? 'MODE=external' : "$runtimeMode = 'external'", script.endsWith('.sh') ? 'MODE=bundled' : "$runtimeMode = 'bundled'")
          .replace(script.endsWith('.sh') ? 'EXPECTED_SHA256=none' : "$expectedSha256 = 'none'", script.endsWith('.sh') ? 'EXPECTED_SHA256=' + runtime.executableSha256 : "$expectedSha256 = '" + runtime.executableSha256 + "'")
        await writeFile(join(destination, script), text)
      }
      for (const name of ['run-node.sh', 'launch.sh']) await chmod(join(destination, name), 0o755)
      const bundledRuntime = bundled ? Object.fromEntries(Object.entries(runtime).filter(([key]) => key !== 'directory')) : null
      await writeFile(join(destination, 'package.json'), JSON.stringify({ name: 'teamsight-mcp', version: pkg.version, type: 'module', private: true, engines: pkg.engines, dependencies: pkg.dependencies }, null, 2) + '\n')
      await writeFile(join(destination, 'versions.json'), JSON.stringify({ version: pkg.version, phase: 'MCP', target, variant: item.variant,
        builtAt: new Date().toISOString(), sourceHead, sourceState: 'working tree; source hashes identify the exact implementation', sourceHashes,
        commonPayloadSha256: sha256(JSON.stringify(baseHashes)), buildNode: process.versions.node, validatedNode: null,
        runtimeAcceptance: 'pending; see separate acceptance evidence', pnpm: '10.12.4', runtimeBundled: bundled, runtime: bundledRuntime,
        dependencies: copied.sort((a, b) => a.name.localeCompare(b.name)), windowsRuntimeAcceptance: 'pending', codexAppsAcceptance: 'pending' }, null, 2) + '\n')
      const shell = target === 'win32-x64' ? 'powershell' : 'sh'
      const launch = target === 'win32-x64' ? '.\\launch.ps1' : './launch.sh'
      const runner = target === 'win32-x64' ? '.\\run-node.ps1' : './run-node.sh'
      const readme = '# TeamSight MCP ' + pkg.version + ' — ' + item.variant + '\n\n' +
        (bundled ? 'Recommended: private Node.js ' + NODE_VERSION + ' included; no global Node installation or PATH change. Runtime integrity is checked at launch.\n' : 'Requires external Node.js 22.14+ (<23), Node-API 10+. No Node runtime included.\n') +
        '\nExtract the complete archive to a writable directory. In that directory run:\n\n' +
        '~~~' + shell + '\n' + launch + ' doctor\n' + runner + ' verify-mcp.mjs --evidence-dir ./evidence\n' + launch + ' serve --data-dir ./data --port 43127\n' +
        '# In another terminal:\n' + launch + ' status --data-dir ./data\n' + launch + ' stop --data-dir ./data\n' + '~~~\n\n' +
        'Use an absolute --data-dir for upgrades or switching editions. Stop the previous instance first; both editions share DB v4/config v6. Do not overwrite a running package. No TAPD configuration or tokens are bundled. Read docs/validation/teamsight-mcp-platforms.md for acceptance and host setup. Never paste access-token or TAPD credentials into chat or public logs.\n\n' +
        'Build metadata is not runtime acceptance. Windows native execution and Codex Apps require separate validation. On Windows, use the PowerShell entrypoints under your existing execution policy; no policy changes are made.\n'
      await writeFile(join(destination, 'README.md'), readme)
      const hashes = await fileHashes(destination)
      await writeFile(join(destination, 'checksums.json'), JSON.stringify(hashes, null, 2) + '\n')
      const archive = join(staging, item.archive)
      run('tar', ['-a', '-cf', archive, '-C', staging, item.name])
      archiveHashes.push(sha256(await readFile(archive)) + '  ' + item.archive)
      publications.push({ from: destination, to: join(releases, item.name) }, { from: archive, to: join(releases, item.archive) })
      results.push({ target, variant: item.variant, output: join(releases, item.name), archive: join(releases, item.archive), runtimeBundled: bundled, files: Object.keys(hashes).length })
    }
  }
  await writeFile(join(staging, checksumName), archiveHashes.join('\n') + '\n')
  publications.push({ from: join(staging, checksumName), to: join(releases, checksumName) })
  await publishFiles(publications)
  console.log(JSON.stringify({ version: pkg.version, packages: results, archiveChecksums: join(releases, checksumName) }))
})
} finally { await rm(lock, { recursive: true, force: true }) }
