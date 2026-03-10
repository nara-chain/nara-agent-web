import { defineConfig } from 'vite'
import { resolve } from 'path'
import { createRequire } from 'module'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const require = createRequire(import.meta.url)
const anchorBrowser = require.resolve('@coral-xyz/anchor/dist/browser/index.js')

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'crypto', 'stream', 'events', 'util', 'process', 'path', 'url', 'string_decoder', 'assert', 'http', 'https', 'zlib', 'os'],
      globals: { Buffer: true, process: true },
    }),
  ],
  resolve: {
    alias: {
      '@coral-xyz/anchor': resolve(__dirname, 'src/anchor-shim.js'),
      '@coral-xyz/anchor-browser': anchorBrowser,
    },
  },
})
