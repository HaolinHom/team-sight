/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

const DEV_SERVER_PORT = 5183;

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: DEV_SERVER_PORT,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
