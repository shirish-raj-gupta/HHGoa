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

// On Vercel every app shares the deployment's origin (vercel.json): the API at /v1, the reviewer site at /, the business
// app at /business, this stage at /stage and the admin console at /admin. Locally each runs on its own port.
const vercelHost = process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL ? process.env.VERCEL_PROJECT_PRODUCTION_URL : process.env.VERCEL_URL;
const origin = process.env.VERCEL && vercelHost ? `https://${vercelHost}` : null;
const url = (name: string, fallback: string) => process.env[`NEXT_PUBLIC_${name}`] ?? process.env[`PUBLIC_${name}`] ?? fallback;

const nextConfig: NextConfig = {
  turbopack: { root },
  // Every page and route handler lives under /stage (BASE_PATH in src/lib/env.ts), the path vercel.json routes here;
  // opened directly, the bare root goes there.
  basePath: '/stage',
  async redirects() {
    return [{ source: '/', destination: '/stage', basePath: false, permanent: false }];
  },
  // The browser tests run a second dev server beside `pnpm dev` (e2e/playwright.config.ts): it needs its own build
  // folder, and its own tsconfig for Next to write that folder's type paths into.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR, typescript: { tsconfigPath: 'tsconfig.e2e.json' } } : {}),
  env: {
    NEXT_PUBLIC_API_URL: url('API_URL', origin ?? 'http://localhost:8787'),
    NEXT_PUBLIC_WEB_URL: url('WEB_URL', origin ?? 'http://localhost:3000'),
  },
};

export default nextConfig;
