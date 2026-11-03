import { build } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
for (const [entry, emptyOutDir] of [['index.html', true], ['settings.html', false], ['analysis.html', false]]) {
  process.env.TEAMSIGHT_MCP_ENTRY = entry
  await build({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    clearScreen: false,
    build: { emptyOutDir },
  })
}
delete process.env.TEAMSIGHT_MCP_ENTRY
