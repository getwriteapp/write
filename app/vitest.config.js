import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

/* Component-test tier, separate from vite.config.js on purpose: it adds a
   test runner and jsdom environment that the real app build has no business
   knowing about. Everything else (the svelte plugin) is duplicated rather
   than shared because a single shared config would need to special-case
   `mode === 'test'` throughout — more indirection than two small files. */
export default defineConfig({
  plugins: [svelte()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/unit/setup.js'],
    include: ['tests/unit/**/*.test.js'],
    // App.svelte attaches its keydown/scroll/resize listeners to window on
    // mount and never gets an unmount from the real app (it lives for the
    // process). A test file mounts and remounts it per test, so without
    // resetting mocks between tests a listener left over from a previous
    // test's instance fires again on the next test's keydown and inflates
    // call counts — restoreMocks + @testing-library/svelte/vitest's
    // auto-cleanup (see setup.js) together keep each test's App instance and
    // spies isolated.
    restoreMocks: true,
  },
  /* Svelte 5 ships separate client and server (SSR) component builds, and a
     bare `svelte`/`@tiptap/*` import resolves to whichever one matches these
     conditions. Without 'browser' here, Vitest's Node-process test runner
     resolves the SERVER build, and mounting throws `lifecycle_function_
     unavailable` — onMount()/mount() only exist client-side. jsdom gives the
     DOM the server build would otherwise have nothing to render into, so
     'browser' is the correct match, not a workaround. */
  resolve: {
    conditions: ['browser'],
  },
})
