import { build } from 'esbuild'
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
const root = fileURLToPath(new URL('..', import.meta.url))
const output = join(root, '.local/windows-manager')
await mkdir(output, { recursive: true })
await build({ entryPoints: [join(root, 'scripts/installer/windows-config.mjs')], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: join(output, 'windows-config.cjs'), legalComments: 'inline' })
await copyFile(join(root, 'scripts/install-windows.ps1'), join(output, 'install-windows.ps1'))
const require = createRequire(import.meta.url), parser = require.resolve('toml-eslint-parser')
let notices = ''
for (const [name, entry] of [['toml-eslint-parser', parser], ['eslint-visitor-keys', createRequire(parser).resolve('eslint-visitor-keys')]]) {
  for (let at = dirname(entry); at !== dirname(at); at = dirname(at)) {
    try {
      const meta = JSON.parse(await readFile(join(at, 'package.json'), 'utf8'))
      if (meta.name === name) { notices += name + '@' + meta.version + '\n' + await readFile(join(at, 'LICENSE'), 'utf8') + '\n'; break }
    } catch {}
  }
}
await writeFile(join(output, 'THIRD-PARTY-LICENSES.txt'), notices)
console.log(output)
