import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// One .env at the repo root serves every app. Only public values are inlined; the agent wallet key, model keys and
// the admin token stay on the server, read by the route handlers at request time.
const root = path.resolve(process.cwd(), '../..');
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f);
  if (existsSync(p)) process.loadEnvFile(p);
}

const nextConfig: NextConfig = {
  turbopack: { root },
  // The browser tests run a second dev server beside `pnpm dev` (e2e/playwright.config.ts): it needs its own build
  // folder, and its own tsconfig for Next to write that folder's type paths into.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR, typescript: { tsconfigPath: 'tsconfig.e2e.json' } } : {}),
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? process.env.PUBLIC_API_URL ?? 'http://localhost:8787',
    NEXT_PUBLIC_WEB_URL: process.env.NEXT_PUBLIC_WEB_URL ?? process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000',
  },
};

export default nextConfig;
