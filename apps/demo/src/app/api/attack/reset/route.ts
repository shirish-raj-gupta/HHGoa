import { admin, stageAuthorized, unauthorized } from '@/lib/server';

/** Remove the planted ring and re-run trust, so the attack can be shown again. */
export async function POST(req: Request) {
  if (!stageAuthorized(req)) return unauthorized();
  return admin('/attack/reset');
}
