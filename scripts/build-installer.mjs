import { build } from 'esbuild'
import { readFile, writeFile, chmod } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
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
const text = await readFile(root + '/scripts/installer/bootstrap.sh', 'utf8') + '/* Bundled (unmodified) third-party licenses; mechanically bundled by esbuild:\n' + licenses.replaceAll('*/', '* /') + '\n*/\n' + result.outputFiles[0].text
if (process.argv.includes('--check')) {
  if (await readFile(root + '/scripts/install.sh', 'utf8') !== text) throw new Error('INSTALLER_GENERATED_FILE_OUTDATED')
} else {
  await writeFile(root + '/scripts/install.sh', text)
  await chmod(root + '/scripts/install.sh', 0o755)
}
