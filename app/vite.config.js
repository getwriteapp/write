import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFileSync } from 'node:fs'

// One source for the version the app shows. package.json is the file the
// release checklist already treats as canonical, so reading it here means the
// Commander cannot drift from the installer's own version number.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: true,
    // Never watch the Rust build output — Cargo churns .exe/.lock files in
    // src-tauri/target and Vite's watcher crashes with EBUSY when it tries to
    // watch a file Cargo is mid-write on. This is required for Tauri + Vite.
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { target: 'esnext' },
  // Tauri expects a fixed port and does its own reloading
  clearScreen: false,
})
