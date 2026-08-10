import { defineConfig } from "vite";

/**
 * Build configuration.
 *
 * `base` must be set from the very first commit. The deploy target is GitHub
 * Pages under a repository subpath, and a missing `base` breaks every asset URL
 * — most visibly the module worker, which 404s and leaves the game stuck on the
 * loading screen with no console error that points at the cause. Change the
 * string here (and nowhere else) if this is ever served from a domain root or
 * from a folder inside simreaney.github.io.
 *
 * `worker.format: "es"` is required because the simulation worker is spawned as
 * `new Worker(url, { type: "module" })`. Vite's default worker format is iife,
 * which cannot carry the static imports the worker relies on.
 */
export default defineConfig({
  base: "/diffusePollutionGame/",
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        // three changes far less often than the game does, so keeping it in its
        // own chunk means a gameplay tweak invalidates a few kilobytes rather
        // than half a megabyte of a returning player's cache.
        manualChunks: {
          three: ["three"],
        },
      },
    },
  },
  test: {
    // `tools/` holds preview and profiling harnesses that write image artefacts
    // and take tens of seconds each. They are runnable — `npx vitest run
    // tools/preview.test.ts` — but the `npm test` script filters to `test/` so
    // they stay out of the default suite and out of CI.
    include: ["test/**/*.test.ts", "tools/**/*.test.ts"],
  },
});
