import { build } from 'esbuild'
import { readFile, writeFile, chmod, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { compareReleases, digest, verifyPayload } from './installer/main.mjs'
const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
async function notice(entry, name) {
  let at = dirname(entry)
  while (at !== dirname(at)) {
    try {
      const pkg = JSON.parse(await readFile(join(at, 'package.json'), 'utf8'))
      if (pkg.name === name) return name + '@' + pkg.version + '\n' + await readFile(join(at, 'LICENSE'), 'utf8')
    } catch {}
    at = dirname(at)
  }
  throw new Error('INSTALLER_LICENSE_MISSING: ' + name)
}
const parserEntry = require.resolve('toml-eslint-parser')
const licenses = await notice(parserEntry, 'toml-eslint-parser') + '\n' + await notice(createRequire(parserEntry).resolve('eslint-visitor-keys'), 'eslint-visitor-keys')
const result = await build({ entryPoints: [root + '/scripts/installer/entry.mjs'], bundle: true, platform: 'node', format: 'cjs', target: 'node22.14', write: false, minify: false, legalComments: 'inline' })
const code = '/* Bundled (unmodified) third-party licenses; mechanically bundled by esbuild:\n' + licenses.replaceAll('*/', '* /') + '\n*/\n' + result.outputFiles[0].text
const [mode, releaseArg, siteArg, version] = process.argv.slice(2)
if (mode === '--pages') {
  if (!releaseArg || !siteArg || typeof version !== 'string') throw new Error('Usage: node scripts/build-installer.mjs --pages RELEASE_DIR SITE_DIR VERSION')
  compareReleases(version, version)
  const releases = resolve(releaseArg), site = resolve(siteArg)
  const sums = await readFile(join(releases, 'SHA256SUMS-darwin-arm64.txt'), 'utf8')
  const template = await readFile(join(root, 'scripts/installer/agent-bootstrap.sh'), 'utf8')
  const bundled = verifyPayload(join(releases, 'teamsight-mcp-darwin-arm64-bundled'))
  const runtimeSha = bundled.runtime?.executableSha256
  if (!/^[a-f0-9]{64}$/.test(runtimeSha) || runtimeSha !== digest(await readFile(join(releases, 'teamsight-mcp-darwin-arm64-bundled/runtime/node')))) throw new Error('INVALID_BUNDLED_RUNTIME_HASH')
  await mkdir(site)
  for (const variant of ['bundled', 'external']) {
    const archive = `teamsight-mcp-${version}-darwin-arm64-${variant}.tar.gz`
    const manifest = variant === 'bundled' ? bundled : verifyPayload(join(releases, `teamsight-mcp-darwin-arm64-${variant}`))
    if (manifest.version !== version || manifest.target !== 'darwin-arm64' || manifest.variant !== variant) throw new Error('PAYLOAD_RELEASE_MISMATCH')
    const archiveSha = digest(await readFile(join(releases, archive)))
    if (!sums.split(/\r?\n/).includes(`${archiveSha}  ${archive}`)) throw new Error('ARCHIVE_HASH_MISMATCH')
    const payloadSha = digest(await readFile(join(releases, `teamsight-mcp-darwin-arm64-${variant}`, 'checksums.json')))
    const fields = { VERSION: version, VARIANT: variant, ARCHIVE: archive, ARCHIVE_SHA: archiveSha, PAYLOAD_SHA: payloadSha, RUNTIME_SHA: runtimeSha,
      URL: `https://github.com/HaolinHom/team-sight/releases/download/v${version}/${archive}`, INSTALLER_JS: code.trimEnd() }
    const bootstrap = template.replace(/@([A-Z_]+)@/g, (_, key) => {
      if (!Object.hasOwn(fields, key)) throw new Error('INVALID_BOOTSTRAP_PLACEHOLDER: ' + key)
      return fields[key]
    })
    if (bootstrap.split('\n').includes('__TEAMSIGHT_AGENT_BOOTSTRAP__')) throw new Error('INVALID_BOOTSTRAP_DELIMITER')
    const script = '#!/bin/sh\n{\n/usr/bin/env -u BASH_ENV -u ENV /bin/bash -s -- "$@" <<\'__TEAMSIGHT_AGENT_BOOTSTRAP__\'\n' + bootstrap.trimEnd() + '\n__TEAMSIGHT_AGENT_BOOTSTRAP__\n}\n'
    await writeFile(join(site, variant === 'bundled' ? 'install-mcp' : 'install-mcp-external'), script, { flag: 'wx', mode: 0o755 })
  }
  await writeFile(join(site, 'index.html'), '<!doctype html><meta charset="utf-8"><title>TeamSight MCP</title><h1>TeamSight MCP</h1><p>macOS arm64 · ' + version + ' · availability and acceptance: see the <a href="https://github.com/HaolinHom/team-sight/releases/tag/v' + version + '">Release notes</a>.</p>\n', { flag: 'wx' })
} else {
  const text = await readFile(root + '/scripts/installer/bootstrap.sh', 'utf8') + code
  if (mode === '--check') {
    if (await readFile(root + '/scripts/install.sh', 'utf8') !== text) throw new Error('INSTALLER_GENERATED_FILE_OUTDATED')
  } else if (mode === undefined) {
    await writeFile(root + '/scripts/install.sh', text)
    await chmod(root + '/scripts/install.sh', 0o755)
  } else throw new Error('INVALID_INSTALLER_BUILD_MODE')
}
