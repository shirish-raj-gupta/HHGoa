import { defineConfig } from 'vitest/config';

// The first DKIM test pays for loading mailauth and postal-mime.
export default defineConfig({ test: { testTimeout: 60_000 } });
