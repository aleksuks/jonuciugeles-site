import { defineConfig } from 'vite';

// FLOWERS_STABLE=1 (set by scripts/verify.mjs): no file watching and no HMR reloads, so a test run is not
// reloaded under its own feet when someone edits a source file.
// (no @types/node in this project, so read the env through globalThis)
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const stable = env.FLOWERS_STABLE === '1';

export default defineConfig({
  server: { host: true, port: 5173, ...(stable ? { hmr: false, watch: null } : {}) },
});
