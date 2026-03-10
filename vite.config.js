import { defineConfig } from 'vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), nodePolyfills({
    include: ['buffer', 'crypto', 'stream', 'events', 'util', 'process', 'path', 'url', 'string_decoder', 'assert', 'http', 'https', 'zlib', 'os'],
    globals: { Buffer: true, process: true },
  }), cloudflare()],
  resolve: {
    alias: {
      '@coral-xyz/anchor': resolve(__dirname, 'src/anchor-shim.js'),
      '@coral-xyz/anchor-browser': resolve(__dirname, 'node_modules/@coral-xyz/anchor/dist/browser/index.js'),
    },
  },
})