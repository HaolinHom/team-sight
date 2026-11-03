// Build-time only: copy the resolved production graph into a portable, symlink-free package.
import { cp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { resolve, join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const root = fileURLToPath(new URL('..', import.meta.url))
const target = process.argv[2] ?? `${process.platform}-${process.arch}`
if (!['darwin-arm64', 'win32-x64'].includes(target)) throw new Error('MCP packages support darwin-arm64 and win32-x64 only; other architectures are not validated.')
const output = resolve(root, 'artifacts/releases', `teamsight-mcp-${target}`)
await mkdir(dirname(output), { recursive: true })
// Refuse overwrite: an earlier validation package may be in use.
await mkdir(output)
const source = join(root, 'apps/server')
const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
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
for (const name of ['verify-mcp.mjs', 'verify.mjs', 'status-mcp.mjs', 'launch.sh', 'launch.ps1']) await cp(join(source, name), join(output, name))
await mkdir(join(output, 'docs/validation'), {recursive:true})
await cp(join(root, 'docs/validation/teamsight-mcp-platforms.md'), join(output, 'docs/validation/teamsight-mcp-platforms.md'))
await cp(join(root, 'docs/TeamSight-MCP-能力与使用说明.md'), join(output, 'docs/TeamSight-MCP-能力与使用说明.md'))
const sourceHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
const sourceFiles = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'scripts/package-mcp.mjs', 'scripts/package-p0.mjs', 'docs/validation/teamsight-mcp-platforms.md', 'docs/TeamSight-MCP-能力与使用说明.md']
async function listFiles(dir) {
  const items = []
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist'].includes(ent.name)) continue
    const p = join(dir, ent.name)
    if (ent.isDirectory()) items.push(...await listFiles(p)); else items.push(p)
  }
  return items
}
sourceFiles.push(...(await listFiles(join(root, 'apps'))).map(p => relative(root, p)), ...(await listFiles(join(root, 'packages'))).map(p=>relative(root,p)))
const sourceHashes = {}
for (const name of sourceFiles.sort()) sourceHashes[name] = createHash('sha256').update(await readFile(join(root, name))).digest('hex')
await writeFile(join(output, 'package.json'), JSON.stringify({ name: 'teamsight-mcp-validation', version: pkg.version, type: 'module', private: true, engines: pkg.engines, scripts: { start: 'node dist/cli.js serve', verify: 'node verify-mcp.mjs' }, dependencies: pkg.dependencies }, null, 2))
await writeFile(join(output, 'versions.json'), JSON.stringify({ version: pkg.version, phase: 'MCP', target, builtAt: new Date().toISOString(), sourceHead, sourceState: 'working tree; source hashes identify the exact implementation', sourceHashes, buildNode: process.versions.node, validatedNode: process.versions.node, pnpm: '10.12.4', runtimeBundled: false, dependencies: copied.sort((a, b) => a.name.localeCompare(b.name)), windowsRuntimeAcceptance: 'pending', codexAppsAcceptance: 'pending' }, null, 2))
await writeFile(join(output, 'README.md'), '# TeamSight MCP validation package\n\nRequires external Node.js 22.14.0+ (<23), baseline 22.23.4. No Node runtime or TAPD configuration is bundled.\n\nRun `node dist/cli.js doctor`, `node verify-mcp.mjs --evidence-dir ./evidence`, then `node dist/cli.js serve --data-dir ./data --port 43127`. Read instance.json for the URL and access-token for the local bearer token. Never paste the token into an Agent message or public log. Follow docs/validation/teamsight-mcp-platforms.md for Codex and manual Apps acceptance. Automatic verification does not certify Codex Apps or host scheduling.\n')
const hashes = {}
async function hashFiles(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isSymbolicLink()) throw new Error(`UNEXPECTED_SYMLINK: ${path}`)
    if (item.isDirectory()) await hashFiles(path)
    else hashes[relative(output, path).split(sep).join('/')] = createHash('sha256').update(await readFile(path)).digest('hex')
  }
}
await hashFiles(output)
await writeFile(join(output, 'checksums.json'), JSON.stringify(hashes, null, 2))
console.log(JSON.stringify({ output, target, files: Object.keys(hashes).length, noSymlinks: true, nodeRuntimeBundled: false }))
