import { admin, stageAuthorized, unauthorized } from '@/lib/server';

export const maxDuration = 120;

/** Plant the simulated review ring (fictional "(demo)" merchants only) and return what the trust engine did. */
export async function POST(req: Request) {
  if (!stageAuthorized(req)) return unauthorized();
  return admin('/attack');
}
