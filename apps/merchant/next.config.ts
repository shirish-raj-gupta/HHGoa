import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// One .env at the repo root serves every app. Public values are inlined here, so the browser bundle gets them.
const root = path.resolve(process.cwd(), '../..');
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f);
  if (existsSync(p)) process.loadEnvFile(p);
}

// A zone of the reviewer site (see apps/web/next.config.ts): every page and asset lives under /business, and people
// reach it through the reviewer site's origin, so the two share one wallet and one sign-in. Opened directly, this
// server's bare root sends people there.
const BUSINESS_URL = process.env.NEXT_PUBLIC_MERCHANT_URL ?? process.env.PUBLIC_MERCHANT_URL ?? 'http://localhost:3000/business';

const nextConfig: NextConfig = {
  turbopack: { root },
  basePath: '/business',
  async redirects() {
    // Only to a /business address (on this server the basePath serves it), so this can never loop, even with an
    // older setting that pointed the business URL at this server's root.
    return new URL(BUSINESS_URL).pathname.startsWith('/business') ? [{ source: '/', destination: BUSINESS_URL, basePath: false, permanent: false }] : [];
  },
  // The browser tests run a second dev server beside `pnpm dev` (e2e/playwright.config.ts): it needs its own build
  // folder, and its own tsconfig for Next to write that folder's type paths into.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR, typescript: { tsconfigPath: 'tsconfig.e2e.json' } } : {}),
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? process.env.PUBLIC_API_URL ?? 'http://localhost:8787',
    NEXT_PUBLIC_WEB_URL: process.env.NEXT_PUBLIC_WEB_URL ?? process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000',
    NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? process.env.PRIVY_APP_ID ?? '',
  },
};

export default nextConfig;
