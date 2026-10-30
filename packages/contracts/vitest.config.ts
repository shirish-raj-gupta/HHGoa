import { defineConfig } from 'vitest/config';

// The in-memory EVM is slower than a native node; give chain tests room.
export default defineConfig({
  test: { testTimeout: 120_000, hookTimeout: 180_000 },
});
