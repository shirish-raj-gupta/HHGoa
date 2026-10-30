// @anon-aadhaar/core publishes its TypeScript sources as its types, and they do not pass a strict typecheck, so the
// compiler never loads them: identity.ts types the module itself. The import in the .js file next to this one is a
// literal, so a bundler or a serverless file tracer (Vercel) still finds the package and ships it.
export function loadAnonAadhaarCore(): Promise<unknown>;
