import { admin, stageAuthorized, unauthorized } from '@/lib/server';

export const maxDuration = 120;

/** Settle every accrued reviewer balance into a USDC root now instead of nightly (the API allows it only in
 *  DEMO_MODE and labels it a demo settlement). */
export async function POST(req: Request) {
  if (!stageAuthorized(req)) return unauthorized();
  return admin('/settle-now');
}
