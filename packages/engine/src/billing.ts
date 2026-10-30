import { newId, usdcToBase } from '@receipts/core';
import { toBigInt } from '@receipts/db';
import { UserError, type Engine } from './context';
import { randomToken, sha256Hex } from './crypto';

// Card customers through Dodo Payments: agent builders buy API credits, merchants subscribe to the paid dashboard
// tier (insights, alerts, receipts). Every paid query by card becomes a Dodo usage event and is booked in the
// ledger with the same 70/30 split as x402. Billing data never reaches the ranking service.

export const CREDIT_PACK_USD = 1; // one unit of DODO_PRODUCT_CREDITS buys $1 of queries

async function dodo(e: Engine) {
  if (!e.env.DODO_API_KEY) throw new UserError('Card payments are not configured on this server (DODO_API_KEY).', 400, 'not_configured');
  const { default: DodoPayments } = await import('dodopayments');
  return new DodoPayments({ bearerToken: e.env.DODO_API_KEY, environment: e.env.DODO_ENV, webhookKey: e.env.DODO_WEBHOOK_SECRET ?? null });
}

export async function createApiKey(e: Engine, input: { email?: string; label?: string }) {
  const key = `rk_${randomToken(24)}`;
  const id = newId('ak');
  await e.db.query('INSERT INTO api_keys (id, key_hash, label, owner_email) VALUES ($1, $2, $3, $4)', [id, sha256Hex(key), input.label ?? null, input.email ?? null]);
  return { id, apiKey: key, note: 'Shown once. Send it as "Authorization: Bearer <key>".' };
}

export async function apiKeyFromHeader(e: Engine, header: string | undefined) {
  const key = header?.replace(/^Bearer\s+/i, '').trim();
  if (!key?.startsWith('rk_')) return null;
  return e.db.maybe<{ id: string; credits_usdc: string; dodo_customer_id: string | null; disabled: boolean }>(
    'SELECT id, credits_usdc::text, dodo_customer_id, disabled FROM api_keys WHERE key_hash = $1',
    [sha256Hex(key)],
  );
}

/** Spend credits for one paid call; 402 when the balance is short. */
export async function chargeCredits(e: Engine, apiKeyId: string, amountBase: bigint, tool: string): Promise<void> {
  const row = await e.db.maybe<{ credits_usdc: string; dodo_customer_id: string | null }>(
    'UPDATE api_keys SET credits_usdc = credits_usdc - $2 WHERE id = $1 AND NOT disabled AND credits_usdc >= $2 RETURNING credits_usdc::text, dodo_customer_id',
    [apiKeyId, amountBase],
  );
  if (!row) throw new UserError('Not enough credits. Buy more, or pay per call with x402.', 402, 'insufficient_credits');
  if (row.dodo_customer_id && e.env.DODO_API_KEY) {
    (await dodo(e)).usageEvents
      .ingest({
        events: [
          {
            event_id: newId('ue'),
            customer_id: row.dodo_customer_id,
            event_name: 'receipts.query',
            timestamp: new Date().toISOString(),
            metadata: { tool, amount_usdc_base: Number(amountBase) },
          },
        ],
      })
      .catch((err: unknown) => e.log.warn('Dodo usage event failed', err));
  }
}

export async function creditsCheckout(e: Engine, input: { apiKeyId: string; email: string; name?: string; dollars: number }) {
  if (!e.env.DODO_PRODUCT_CREDITS) throw new UserError('DODO_PRODUCT_CREDITS is not set.', 400, 'not_configured');
  const client = await dodo(e);
  const session = await client.checkoutSessions.create({
    product_cart: [{ product_id: e.env.DODO_PRODUCT_CREDITS, quantity: Math.max(1, Math.round(input.dollars / CREDIT_PACK_USD)) }],
    customer: { email: input.email, name: input.name ?? input.email },
    return_url: `${e.urls.web}/developers?checkout=done`,
    metadata: { apiKeyId: input.apiKeyId, kind: 'credits' },
  } as never);
  return { checkoutUrl: (session as { checkout_url?: string }).checkout_url ?? null, sessionId: (session as { session_id: string }).session_id };
}

export async function merchantCheckout(e: Engine, input: { accountId: string; email: string; name?: string }) {
  if (!e.env.DODO_PRODUCT_MERCHANT_PRO) throw new UserError('DODO_PRODUCT_MERCHANT_PRO is not set.', 400, 'not_configured');
  const client = await dodo(e);
  const session = await client.checkoutSessions.create({
    product_cart: [{ product_id: e.env.DODO_PRODUCT_MERCHANT_PRO, quantity: 1 }],
    customer: { email: input.email, name: input.name ?? input.email },
    return_url: `${e.urls.merchant}/billing?checkout=done`,
    metadata: { accountId: input.accountId, kind: 'merchant_pro' },
  } as never);
  return { checkoutUrl: (session as { checkout_url?: string }).checkout_url ?? null, sessionId: (session as { session_id: string }).session_id };
}

/** Verified by the Standard Webhooks signature (webhook-id, webhook-timestamp, webhook-signature); idempotent by id. */
export async function handleDodoWebhook(e: Engine, rawBody: string, headers: Record<string, string>) {
  const client = await dodo(e);
  let event: { type: string; data: Record<string, unknown> & { metadata?: Record<string, string>; customer?: { customer_id?: string }; total_amount?: number } };
  try {
    event = client.webhooks.unwrap(rawBody, { headers }) as never;
  } catch {
    throw new UserError('bad webhook signature', 401);
  }
  const id = headers['webhook-id'] ?? newId('wh');
  const seen = await e.db.maybe('SELECT 1 FROM billing_events WHERE id = $1', [id]);
  if (seen) return { duplicate: true };
  await e.db.query('INSERT INTO billing_events (id, provider, type, payload) VALUES ($1, $2, $3, $4)', [id, 'dodo', event.type, event]);
  const meta = event.data.metadata ?? {};
  if (event.type === 'payment.succeeded' && meta.kind === 'credits' && meta.apiKeyId) {
    const cents = Number(event.data.total_amount ?? 0);
    const credit = usdcToBase((cents / 100).toFixed(2));
    await e.db.query('UPDATE api_keys SET credits_usdc = credits_usdc + $2, dodo_customer_id = COALESCE(dodo_customer_id, $3) WHERE id = $1', [
      meta.apiKeyId,
      credit,
      event.data.customer?.customer_id ?? null,
    ]);
    await e.events.emit('billing.credits', { apiKeyId: meta.apiKeyId, usd: cents / 100 });
  } else if (event.type === 'subscription.active' && meta.accountId) {
    await e.db.query(`UPDATE merchant_accounts SET plan = 'pro', dodo_customer_id = $2, dodo_subscription_id = $3 WHERE id = $1`, [
      meta.accountId,
      event.data.customer?.customer_id ?? null,
      (event.data as { subscription_id?: string }).subscription_id ?? null,
    ]);
    await e.events.emit('billing.merchant_pro', { accountId: meta.accountId });
  } else if ((event.type === 'subscription.cancelled' || event.type === 'subscription.expired') && meta.accountId) {
    await e.db.query(`UPDATE merchant_accounts SET plan = 'free' WHERE id = $1`, [meta.accountId]);
  }
  return { ok: true, type: event.type };
}

export async function creditBalance(e: Engine, apiKeyId: string) {
  const row = await e.db.one<{ credits_usdc: string }>('SELECT credits_usdc::text FROM api_keys WHERE id = $1', [apiKeyId]);
  return toBigInt(row.credits_usdc);
}
