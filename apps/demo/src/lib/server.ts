import type { Hex } from 'viem';
import { API_URL } from './env';

// Server-side settings for the stage routes. The agent spends real (testnet) USDC and the attack writes to the
// database, so a deployed stage sets DEMO_TOKEN and the operator enters it once; locally nothing is needed.

export function stageAuthorized(req: Request): boolean {
  const token = process.env.DEMO_TOKEN;
  return !token || req.headers.get('x-demo-token') === token;
}

export function unauthorized() {
  return Response.json({ error: 'This stage needs its operator token (DEMO_TOKEN).' }, { status: 401 });
}

export const agentSettings = () => ({
  apiUrl: process.env.RECEIPTS_API_URL ?? API_URL,
  privateKey: (process.env.AGENT_PRIVATE_KEY as Hex | undefined) ?? null,
  network: process.env.AGENT_NETWORK ?? process.env.X402_NETWORK ?? 'eip155:84532',
  maxSpendUsdc: Number(process.env.AGENT_BUDGET_USDC ?? '0.05'),
});

/** Operator calls to the API's /v1/admin routes, with the admin token added here rather than in the browser. */
export async function admin(path: string, body: unknown = {}) {
  const res = await fetch(`${process.env.RECEIPTS_API_URL ?? API_URL}/v1/admin${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(process.env.ADMIN_TOKEN ? { 'x-admin-token': process.env.ADMIN_TOKEN } : {}) },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
}
