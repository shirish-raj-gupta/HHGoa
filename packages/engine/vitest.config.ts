import { defineConfig } from 'vitest/config';

// The integration test boots PGlite (Postgres in WASM) and an in-memory EVM; both are slow to start.
export default defineConfig({
  test: { testTimeout: 300_000, hookTimeout: 300_000, fileParallelism: false },
});
