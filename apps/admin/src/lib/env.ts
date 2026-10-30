// Public URLs (inlined at build by next.config.ts). Plain values, so server and client components can both import them.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';
export const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';
export const MERCHANT_URL = process.env.NEXT_PUBLIC_MERCHANT_URL ?? 'http://localhost:3000/business';
export const DEMO_URL = process.env.NEXT_PUBLIC_DEMO_URL ?? 'http://localhost:3002/stage';
