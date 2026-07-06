import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
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
