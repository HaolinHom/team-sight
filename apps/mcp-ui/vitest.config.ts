import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),plugins:[vue()],resolve:{alias:{vue:fileURLToPath(new URL('../../node_modules/vue',import.meta.url))},dedupe:['vue']},test:{environment:'jsdom',include:['src/**/*.spec.ts']}})
