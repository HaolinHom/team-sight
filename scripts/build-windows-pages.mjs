import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { digest, compareReleases } from './installer/main.mjs'
import { verifyWindowsPayload } from './installer/windows-agent.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const parser = require.resolve('toml-eslint-parser')
async function license(entry, name) {
  for (let at = dirname(entry); dirname(at) !== at; at = dirname(at)) {
    const manifest = await readFile(join(at, 'package.json'), 'utf8').catch(() => null)
    if (manifest && JSON.parse(manifest).name === name) return name + '\n' + await readFile(join(at, 'LICENSE'), 'utf8')
  }
  throw Error('MISSING_LICENSE: ' + name)
}

export async function windowsPages(releases, site, version, fixture = null) {
  compareReleases(version, version)
  const licenses = await license(parser, 'toml-eslint-parser') + '\n' + await license(createRequire(parser).resolve('eslint-visitor-keys'), 'eslint-visitor-keys')
  const output = await build({ entryPoints: [join(root, 'scripts/installer/windows-entry.mjs')], bundle: true, platform: 'node', format: 'cjs', target: 'node22.14', write: false, legalComments: 'inline' })
  const agent = Buffer.from('/*\n' + licenses.replaceAll('*/', '* /') + '\n*/\n' + output.outputFiles[0].text)
  const template = await readFile(join(root, 'scripts/installer/windows-bootstrap.ps1'), 'utf8')
  const sums = (await readFile(join(releases, 'SHA256SUMS-win32-x64.txt'), 'utf8')).trim().split(/\r?\n/)
  if (sums.length !== 2) throw Error('INVALID_ARCHIVE_MANIFEST')
  const entries = await Promise.all(['bundled', 'external'].map(async variant => {
    const archive = `teamsight-mcp-${version}-win32-x64-${variant}.zip`
    const name = `teamsight-mcp-win32-x64-${variant}`, directory = join(releases, name)
    const manifestSha = digest(await readFile(join(directory, 'checksums.json')))
    const manifest = verifyWindowsPayload(directory, version, variant, manifestSha)
    const zip = await readFile(join(releases, archive)), sha = digest(zip)
    if (!sums.includes(`${sha}  ${archive}`)) throw Error('ARCHIVE_HASH_MISMATCH')
    const url = fixture ? `${fixture.origin}/${archive}` : `https://github.com/HaolinHom/team-sight/releases/download/v${version}/${archive}`
    if (fixture && !/^https:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(fixture.origin)) throw Error('INVALID_FIXTURE_ORIGIN')
    const fields = { VERSION: version, VARIANT: variant, DIRECTORY: name, URL: url, ZIP_SHA: sha, ZIP_SIZE: zip.length,
      MANIFEST_SHA: manifestSha, NODE_SHA: manifest.runtime?.executableSha256 ?? '', AGENT: agent.toString('base64'),
      AGENT_SHA: digest(agent), FIXTURE: fixture ? '$true' : '$false' }
    const script = template.replace(/@([A-Z_]+)@/g, (_, key) => {
      if (!Object.hasOwn(fields, key)) throw Error('INVALID_WINDOWS_PLACEHOLDER: ' + key)
      return fields[key]
    }).replace(/\r?\n/g, '\r\n')
    if (/[^\x00-\x7F]/.test(script)) throw Error('WINDOWS_ENTRY_MUST_BE_ASCII')
    return [variant === 'bundled' ? 'install-mcp.ps1' : 'install-mcp-external.ps1', script]
  }))
  await mkdir(site)
  for (const [name, script] of entries) await writeFile(join(site, name), script, { flag: 'wx' })
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const [releaseArg, siteArg, version, ...extra] = process.argv.slice(2)
  if (!releaseArg || !siteArg || !version || extra.length) throw Error('Usage: node scripts/build-windows-pages.mjs RELEASE_DIR SITE_DIR VERSION')
  await windowsPages(resolve(releaseArg), resolve(siteArg), version)
}
