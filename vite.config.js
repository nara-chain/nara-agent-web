import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), nodePolyfills({
    include: ['buffer', 'crypto', 'stream', 'events', 'util', 'process', 'path', 'url', 'string_decoder', 'assert', 'http', 'https', 'zlib', 'os'],
    globals: { Buffer: true, process: true },
  }), cloudflare()],
})