import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

const root = dirname(fileURLToPath(import.meta.url))
const entry = process.env.TEAMSIGHT_MCP_ENTRY
const input = entry ? resolve(root, entry) : {
  settings: resolve(root, 'settings.html'),
  analysis: resolve(root, 'analysis.html'),
}

export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  build: {
    rollupOptions: {
      input,
    },
  },
})
