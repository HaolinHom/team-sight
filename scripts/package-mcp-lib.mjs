import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'

export const NODE_VERSION = '22.23.4'
export const NODE_ARCHIVES = {
  'darwin-arm64': { name: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`, sha256: 'c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428', executable: 'bin/node' },
  'win32-x64': { name: `node-v${NODE_VERSION}-win-x64.zip`, sha256: 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20', executable: 'node.exe' },
}
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function packageTargets(args, host = `${process.platform}-${process.arch}`) {
  const value = args[0] ?? host
  if (args.length > 1 || value !== 'all' && !Object.hasOwn(NODE_ARCHIVES, value)) throw new Error('INVALID_TARGET: use darwin-arm64, win32-x64 or all')
  return value === 'all' ? Object.keys(NODE_ARCHIVES) : [value]
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw new Error(`PACKAGE_COMMAND_FAILED: ${command}: ${result.error.message}`, { cause: result.error })
  if (result.status !== 0) throw new Error(`PACKAGE_COMMAND_FAILED: ${command}: ${result.signal ?? `exit ${result.status}`}`)
}

export function archiveTool() {
  return process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
}

export async function createPackageArchive(staging, directoryName, archiveName, files) {
  const archive = join(staging, archiveName)
  if (archiveName.endsWith('.zip')) {
    const zip = new yazl.ZipFile()
    zip.on('error', error => zip.outputStream.destroy(error))
    for (const file of files) zip.addFile(join(staging, directoryName, file), `${directoryName}/${file}`)
    const written = pipeline(zip.outputStream, createWriteStream(archive, { flags: 'wx' }))
    zip.end()
    await written
  } else {
    run(archiveTool(), ['-a', '-cf', archive, '-C', staging, directoryName])
  }
}

export async function extractZipArchive(archive, destination, expectedRoot) {
  const zip = await yauzl.openPromise(archive, { strictFileNames: true, autoClose: false })
  const paths = new Set()
  try {
    for await (const entry of zip.eachEntry()) {
      const directory = entry.fileName.endsWith('/')
      const name = directory ? entry.fileName.slice(0, -1) : entry.fileName
      const parts = name.split('/')
      const type = (entry.externalFileAttributes >>> 16) & 0xf000
      const key = name.toLowerCase()
      if (parts[0] !== expectedRoot || (!directory && parts.length < 2) ||
          parts.some(part => !part || /[\x00-\x1f<>:"|?*]|[. ]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(part)) ||
          paths.has(key) || (type !== 0 && type !== (directory ? 0x4000 : 0x8000)) ||
          (entry.externalFileAttributes & 0x400)) throw new Error(`UNSAFE_ZIP_ENTRY: ${entry.fileName}`)
      paths.add(key)
      const path = join(destination, ...parts)
      if (directory) await mkdir(path, { recursive: true })
      else {
        await mkdir(dirname(path), { recursive: true })
        await pipeline(await zip.openReadStreamPromise(entry), createWriteStream(path, { flags: 'wx' }))
      }
    }
  } finally { zip.close() }
}

export async function requireAbsent(paths) {
  for (const path of paths) {
    try { await access(path) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    throw new Error(`OUTPUT_EXISTS: ${path}`)
  }
}

export async function cachedDownload(path, url, expected, fetcher = fetch) {
  let bytes
  try { bytes = await readFile(path) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (bytes) {
    if (sha256(bytes) !== expected) throw new Error('RUNTIME_CACHE_HASH_MISMATCH: remove the corrupt archive and retry')
    return bytes
  }
  const response = await fetcher(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`RUNTIME_DOWNLOAD_FAILED: HTTP ${response.status}`)
  bytes = Buffer.from(await response.arrayBuffer())
  if (sha256(bytes) !== expected) throw new Error('RUNTIME_ARCHIVE_HASH_MISMATCH')
  await writeFile(path, bytes, { flag: 'wx' })
  return bytes
}

export async function prepareRuntime(root, target, staging) {
  const spec = NODE_ARCHIVES[target]
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${spec.name}`
  const cache = join(root, '.local/node-runtime-cache')
  await mkdir(cache, { recursive: true })
  const archive = join(cache, spec.name)
  await cachedDownload(archive, url, spec.sha256)
  const extracted = await mkdtemp(join(staging, 'node-'))
  const directoryName = spec.name.replace(/\.(tar\.gz|zip)$/, '')
  if (target === 'win32-x64') await extractZipArchive(archive, extracted, directoryName)
  else run(archiveTool(), ['-xf', archive, '-C', extracted])
  const source = join(extracted, directoryName)
  const runtime = join(staging, `runtime-${target}`)
  await mkdir(runtime)
  const executable = target === 'win32-x64' ? 'node.exe' : 'node'
  await cp(join(source, spec.executable), join(runtime, executable))
  await cp(join(source, 'LICENSE'), join(runtime, 'LICENSE'))
  if (target === 'darwin-arm64') await chmod(join(runtime, executable), 0o755)
  return { directory: runtime, version: NODE_VERSION, sourceUrl: url, archiveSha256: spec.sha256, executable: `runtime/${executable}`, executableSha256: sha256(await readFile(join(runtime, executable))) }
}

export async function fileHashes(directory) {
  const hashes = {}
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`UNEXPECTED_SYMLINK: ${path}`)
      if (entry.isDirectory()) await walk(path)
      else hashes[relative(directory, path).split(sep).join('/')] = sha256(await readFile(path))
    }
  }
  await walk(directory)
  return hashes
}

export async function withStaging(parent, operation) {
  await mkdir(parent, { recursive: true })
  const staging = await mkdtemp(join(parent, '.packaging-'))
  try { return await operation(staging) } finally { await rm(staging, { recursive: true, force: true }) }
}

export async function publishFiles(entries) {
  await requireAbsent(entries.map(entry => entry.to))
  const published = []
  try {
    for (const entry of entries) { await rename(entry.from, entry.to); published.push(entry.to) }
  } catch (error) {
    for (const path of published.reverse()) await rm(path, { recursive: true, force: true })
    throw error
  }
}
