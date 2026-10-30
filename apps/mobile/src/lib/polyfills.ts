import { getRandomValues } from 'expo-crypto';

// viem signs with noble's pure-JS curves, which read crypto.getRandomValues when their modules load. Hermes may not
// provide it, so this runs before anything imports viem (it is the first import of the root layout).
const g = globalThis as { crypto?: { getRandomValues?: unknown } };
if (!g.crypto) g.crypto = {};
if (typeof g.crypto.getRandomValues !== 'function') g.crypto.getRandomValues = getRandomValues;
