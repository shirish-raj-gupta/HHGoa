import { ApiError, ReceiptsClient } from '@receipts/client';
import { API_URL } from './env';

// Server components read public data straight from the API, uncached: receipts change as follow-ups and replies land.
export const serverClient = new ReceiptsClient({ baseUrl: API_URL, fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) });

export async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
