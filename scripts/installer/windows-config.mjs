// Bundled by esbuild for the installed manager; never prints credentials.
import * as fs from 'node:fs'
import { join, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { configureCodex, deleteConfigPath, parseConfig } from './config.mjs'

const [action, path, data, url] = process.argv.slice(2)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
try {
  if (action === 'verify') {
    const expected = JSON.parse(fs.readFileSync(join(path, 'checksums.json'))), seen = new Set()
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name)
        if (entry.isSymbolicLink()) throw Error('PAYLOAD_LINK_REFUSED')
        if (entry.isDirectory()) walk(file)
        else {
          const key = relative(path, file).split(sep).join('/')
          if (key === 'checksums.json') continue
          if (!entry.isFile() || digest(fs.readFileSync(file)) !== expected[key]) throw Error('PAYLOAD_HASH_MISMATCH')
          seen.add(key)
        }
      }
    }
    walk(path)
    if (seen.size !== Object.keys(expected).length) throw Error('PAYLOAD_FILE_SET_MISMATCH')
    const manifest = JSON.parse(fs.readFileSync(join(path, 'versions.json')))
    if (manifest.target !== 'win32-x64' || manifest.variant !== 'bundled' || manifest.version !== '0.3.4') throw Error('PAYLOAD_UNSUPPORTED')
    console.log(JSON.stringify({ version: manifest.version, manifestSha256: digest(fs.readFileSync(join(path, 'checksums.json'))) }))
  } else {
    const original = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : ''
    let output
    if (action === 'configure') output = configureCodex(original, url, fs.readFileSync(join(data, 'access-token'), 'utf8').trim())
    else if (action === 'remove') {
      const current = parseConfig(original).mcp_servers?.teamsight
      if (current?.url !== url || current?.http_headers?.Authorization !== 'Bearer ' + fs.readFileSync(join(data, 'access-token'), 'utf8').trim()) throw Error('CODEX_CONNECTION_CHANGED')
      output = deleteConfigPath(original, ['mcp_servers', 'teamsight'])
    } else throw Error('INVALID_ACTION')
    // Stage alongside the original; the PowerShell manager applies protected ACLs before publishing.
    fs.writeFileSync(path + '.teamsight-stage', output, { flag: 'wx' })
    console.log(JSON.stringify({ ok: true }))
  }
} catch (error) {
  console.error(/^(PAYLOAD_|CODEX_|INVALID_)/.test(error.message) ? error.message.split(':')[0] : 'CONFIG_OPERATION_FAILED')
  process.exitCode = 1
}
