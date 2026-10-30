import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { PRICES_USDC, baseToUsdc, canonicalJson, usdcToBase, type PaidTool } from '@receipts/core';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import type { Engine } from './context';
import { sha256Hex } from './crypto';
import { accrueAnswer } from './payouts';

// x402 on Base: the first call gets a 402 with the price, network, asset (USDC) and treasury address; the second
// carries a signed USDC authorization, the facilitator verifies it, the query runs, and the payment settles. The
// settlement hook links the transaction to the logged answer and accrues reviewer earnings.

export interface X402 {
  server: x402ResourceServer;
  network: `${string}:${string}`;
  payTo: string;
  price(tool: PaidTool): string;
  priceBase(tool: PaidTool): bigint;
  /** Stable reference to one payment, computed the same way in the handler and in the settlement hook. */
  refOf(paymentPayload: unknown): string;
}

export function paymentRef(paymentPayload: unknown): string {
  const p = paymentPayload as { payload?: unknown };
  return sha256Hex(canonicalJson(p?.payload ?? p ?? null));
}

/** The paying wallet inside an exact-scheme EVM payment payload. */
export function payerOf(paymentPayload: unknown): string | null {
  const p = paymentPayload as { payload?: { authorization?: { from?: string } } };
  return p?.payload?.authorization?.from?.toLowerCase() ?? null;
}

export async function createX402(e: Engine): Promise<X402 | null> {
  if (e.env.X402_MODE !== 'on') {
    e.log.info('x402: off (paid tools answer for free, labelled "free"). Set X402_MODE=on with a funded chain to charge.');
    return null;
  }
  const payTo =
    e.env.X402_PAY_TO ?? e.env.TREASURY_ADDRESS ?? (e.env.OPERATOR_PRIVATE_KEY ? privateKeyToAccount(e.env.OPERATOR_PRIVATE_KEY as Hex).address : undefined);
  if (!payTo) {
    e.log.warn('x402: no X402_PAY_TO / TREASURY_ADDRESS; paid tools are off');
    return null;
  }
  const network = e.env.X402_NETWORK as `${string}:${string}`;
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: e.env.X402_FACILITATOR_URL })).register(network as never, new ExactEvmScheme());
  server.onAfterSettle(async (ctx) => {
    const ref = paymentRef(ctx.paymentPayload);
    const tx = ctx.result.transaction;
    const rows = await e.db.query<{ id: string }>(`UPDATE answers SET payment_tx = $2 WHERE response->>'payment_ref' = $1 AND payment_tx IS NULL RETURNING id`, [ref, tx]);
    for (const r of rows) {
      await accrueAnswer(e, r.id);
      await e.events.emit('payment.settled', { answerId: r.id, tx, network: ctx.result.network, payer: ctx.result.payer ?? payerOf(ctx.paymentPayload) });
    }
  });
  try {
    await server.initialize();
  } catch (err) {
    e.log.warn(`x402: facilitator ${e.env.X402_FACILITATOR_URL} unreachable at startup; will retry per request`, err);
  }
  e.log.info(`x402: on (${network}) via ${e.env.X402_FACILITATOR_URL}, paying ${payTo}`);
  return {
    server,
    network,
    payTo,
    price: (tool) => `$${PRICES_USDC[tool]}`,
    priceBase: (tool) => usdcToBase(PRICES_USDC[tool]),
    refOf: paymentRef,
  };
}

/** Server-side guard on top of the agent's own spend policy: a per-agent daily cap. */
export async function withinAgentCap(e: Engine, payer: string | null, addBase: bigint): Promise<boolean> {
  if (!payer) return true;
  const row = await e.db.one<{ spent: string | null }>(
    `SELECT sum(price_usdc)::text AS spent FROM answers WHERE agent_wallet = $1 AND created_at > now() - interval '1 day' AND payment_method = 'x402'`,
    [payer.toLowerCase()],
  );
  return BigInt(row.spent ?? '0') + addBase <= usdcToBase(e.env.AGENT_DAILY_CAP_USDC);
}

export { baseToUsdc };
