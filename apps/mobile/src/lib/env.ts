import Constants from 'expo-constants';

// In development the API runs on the same laptop as Metro, so its host is the dev server's host. A phone on the same
// Wi-Fi reaches it there; set EXPO_PUBLIC_API_URL for anything else (a tunnel, staging, production).
function devApi(): string {
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:8787` : 'http://localhost:8787';
}

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? devApi();
export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? API_URL.replace(/:8787$/, ':3000');
/** The business app lives at /business on the reviewer site (one origin, one account). */
export const MERCHANT_URL = process.env.EXPO_PUBLIC_MERCHANT_URL ?? `${WEB_URL}/business`;

/** Receipt links come back as web URLs; open them in the app instead. */
export function receiptIdFromUrl(url: string): string | null {
  return /\/r\/([^/?#]+)/.exec(url)?.[1] ?? null;
}
