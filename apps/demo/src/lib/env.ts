export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';
export const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';

/** Every page and route handler of the stage lives under this (basePath in next.config.ts, the path vercel.json routes
 *  here). fetch() to the stage's own route handlers must include it; links and the router add it themselves. */
export const BASE_PATH = '/stage';
