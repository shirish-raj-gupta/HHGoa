import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// One .env at the repo root serves every app. Public values are inlined here, so the browser bundle gets them.
const root = path.resolve(process.cwd(), '../..');
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f);
  if (existsSync(p)) process.loadEnvFile(p);
}

// The business app is a zone of this site (Next.js multi-zones): apps/merchant serves /business from its own server
// (basePath '/business') and this app proxies those paths to it, so reviewing and running a business share one
// origin, so one wallet and one sign-in. BUSINESS_ZONE_URL is where that server runs.
const BUSINESS_ZONE = process.env.BUSINESS_ZONE_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  turbopack: { root },
  async rewrites() {
    return [
      { source: '/business', destination: `${BUSINESS_ZONE}/business` },
      { source: '/business/:path+', destination: `${BUSINESS_ZONE}/business/:path+` },
    ];
  },
  // The browser tests run a second dev server beside `pnpm dev` (e2e/playwright.config.ts): it needs its own build
  // folder, and its own tsconfig for Next to write that folder's type paths into.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR, typescript: { tsconfigPath: 'tsconfig.e2e.json' } } : {}),
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? process.env.PUBLIC_API_URL ?? 'http://localhost:8787',
    NEXT_PUBLIC_WEB_URL: process.env.NEXT_PUBLIC_WEB_URL ?? process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000',
    NEXT_PUBLIC_MERCHANT_URL: process.env.NEXT_PUBLIC_MERCHANT_URL ?? process.env.PUBLIC_MERCHANT_URL ?? 'http://localhost:3000/business',
    NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? process.env.PRIVY_APP_ID ?? '',
  },
};

export default nextConfig;
