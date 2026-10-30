import { newId, usdcToBase } from '@receipts/core';
import { toBigInt } from '@receipts/db';
import type { UnwrapWebhookEvent } from 'dodopayments/resources/webhooks';
import { z } from 'zod';
import { UserError, type Engine } from './context';
import { randomToken, sha256Hex } from './crypto';

// Card customers through Dodo Payments: agent builders buy API credits, merchants subscribe to the paid dashboard
// tier (insights, alerts, receipts). Every paid query by card becomes a Dodo usage event and is booked in the
// ledger with the same 70/30 split as x402. Billing data never reaches the ranking service.

export const CREDIT_PACK_USD = 1; // one unit of DODO_PRODUCT_CREDITS buys $1 of queries
const customerInput = z.object({ email: z.email(), name: z.string().trim().min(1).max(200).optional() });

function customer(input: { email: string; name?: string }) {
  const parsed = customerInput.safeParse(input);
  if (!parsed.success) throw new UserError('Enter a valid email address and name.', 400);
  return { email: parsed.data.email, name: parsed.data.name ?? parsed.data.email };
}

function requireWebhook(e: Engine) {
  if (!e.env.DODO_WEBHOOK_SECRET) throw new UserError('Card payments need DODO_WEBHOOK_SECRET before checkout can be fulfilled.', 503, 'not_configured');
}

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
  const buyer = customer(input);
  if (!Number.isSafeInteger(input.dollars) || input.dollars < CREDIT_PACK_USD || input.dollars > 10_000) {
    throw new UserError('Choose a whole-dollar credit amount from $1 to $10,000.', 400);
  }
  if (!(await e.db.maybe('SELECT id FROM api_keys WHERE id = $1 AND NOT disabled', [input.apiKeyId]))) throw new UserError('Unknown or disabled API key.', 403);
  requireWebhook(e);
  if (!e.env.DODO_PRODUCT_CREDITS) throw new UserError('DODO_PRODUCT_CREDITS is not set.', 400, 'not_configured');
  const client = await dodo(e);
  const session = await client.checkoutSessions.create({
    product_cart: [{ product_id: e.env.DODO_PRODUCT_CREDITS, quantity: input.dollars / CREDIT_PACK_USD }],
    customer: buyer,
    return_url: `${e.urls.web}/developers?checkout=done`,
    metadata: { apiKeyId: input.apiKeyId, kind: 'credits' },
  });
  if (!session.checkout_url) throw new UserError('Dodo did not return a checkout URL. Please try again.', 502, 'checkout_unavailable');
  return { checkoutUrl: session.checkout_url, sessionId: session.session_id };
}

export async function merchantCheckout(e: Engine, input: { accountId: string; wallet: string; email: string; name?: string }) {
  const account = await e.db.maybe<{ plan: string }>('SELECT plan FROM merchant_accounts WHERE id = $1 AND wallet = $2', [input.accountId, input.wallet.toLowerCase()]);
  if (!account) throw new UserError('Not your listing.', 403);
  if (account.plan === 'pro') throw new UserError('This business already has the Pro plan.', 409);
  const buyer = customer(input);
  requireWebhook(e);
  if (!e.env.DODO_PRODUCT_MERCHANT_PRO) throw new UserError('DODO_PRODUCT_MERCHANT_PRO is not set.', 400, 'not_configured');
  const client = await dodo(e);
  const session = await client.checkoutSessions.create({
    product_cart: [{ product_id: e.env.DODO_PRODUCT_MERCHANT_PRO, quantity: 1 }],
    customer: buyer,
    return_url: `${e.urls.merchant}/billing?checkout=done`,
    metadata: { accountId: input.accountId, kind: 'merchant_pro' },
  });
  if (!session.checkout_url) throw new UserError('Dodo did not return a checkout URL. Please try again.', 502, 'checkout_unavailable');
  return { checkoutUrl: session.checkout_url, sessionId: session.session_id };
}

/** Verified by the Standard Webhooks signature (webhook-id, webhook-timestamp, webhook-signature); idempotent by id. */
export async function handleDodoWebhook(e: Engine, rawBody: string, headers: Record<string, string>) {
  requireWebhook(e);
  const client = await dodo(e);
  let event: UnwrapWebhookEvent;
  try {
    event = client.webhooks.unwrap(rawBody, { headers });
  } catch {
    throw new UserError('bad webhook signature', 401);
  }
  const id = headers['webhook-id'];
  if (!id || !event || typeof event.type !== 'string' || !event.data) throw new UserError('Invalid webhook payload.', 400);
  let notification: { type: string; data: Record<string, unknown> } | undefined;
  const result = await e.db.tx(async (db) => {
    // Claim and fulfill in the same transaction: concurrent delivery is safe, and a failed write can be retried.
    const inserted = await db.maybe('INSERT INTO billing_events (id, provider, type, payload) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id', [id, 'dodo', event.type, event]);
    if (!inserted) return { duplicate: true };
    if (event.type === 'payment.succeeded' && event.data.metadata?.kind === 'credits') {
      const payment = event.data;
      const apiKeyId = payment.metadata.apiKeyId;
      const cart = payment.product_cart;
      if (!apiKeyId || !payment.payment_id || payment.status !== 'succeeded' || !e.env.DODO_PRODUCT_CREDITS || !cart?.length || cart.some((item) => item.product_id !== e.env.DODO_PRODUCT_CREDITS || !Number.isSafeInteger(item.quantity) || item.quantity < 1)) {
        throw new UserError('Invalid credit payment.', 400);
      }
      const quantity = cart.reduce((sum, item) => sum + item.quantity, 0);
      if (!Number.isSafeInteger(quantity) || quantity > 10_000) throw new UserError('Invalid credit quantity.', 400);
      // A product unit buys $1 of queries. Tax and adaptive/local currency charges do not buy extra credits.
      const dollars = quantity * CREDIT_PACK_USD;
      const paymentClaim = await db.maybe('INSERT INTO billing_events (id, provider, type, payload) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id', [`dodo:payment:${payment.payment_id}`, 'dodo', 'credits.fulfilled', { apiKeyId, dollars }]);
      if (!paymentClaim) return { duplicate: true };
      const credited = await db.maybe('UPDATE api_keys SET credits_usdc = credits_usdc + $2, dodo_customer_id = COALESCE(dodo_customer_id, $3) WHERE id = $1 RETURNING id', [apiKeyId, usdcToBase(String(dollars)), payment.customer?.customer_id ?? null]);
      if (!credited) throw new UserError('Unknown credit account.', 400);
      notification = { type: 'billing.credits', data: { apiKeyId, usd: dollars } };
    } else if (
      event.type === 'subscription.active' || event.type === 'subscription.renewed' || event.type === 'subscription.updated' ||
      event.type === 'subscription.unpaused' || event.type === 'subscription.cancelled' || event.type === 'subscription.expired' ||
      event.type === 'subscription.failed' || event.type === 'subscription.on_hold' || event.type === 'subscription.paused' || event.type === 'subscription.past_due'
    ) {
      const subscription = event.data;
      const accountId = subscription.metadata?.accountId;
      if (subscription.metadata?.kind !== 'merchant_pro') return { ok: true, type: event.type };
      if (!accountId || !subscription.subscription_id || !e.env.DODO_PRODUCT_MERCHANT_PRO || subscription.product_id !== e.env.DODO_PRODUCT_MERCHANT_PRO || !Number.isFinite(Date.parse(event.timestamp))) {
        throw new UserError('Invalid merchant subscription.', 400);
      }
      const account = await db.maybe<{ plan: string; dodo_subscription_id: string | null }>('SELECT plan, dodo_subscription_id FROM merchant_accounts WHERE id = $1 FOR UPDATE', [accountId]);
      if (!account) throw new UserError('Unknown merchant account.', 400);
      const stateId = `dodo:subscription:${accountId}`;
      const state = await db.maybe<{ payload: { timestamp: string } }>('SELECT payload FROM billing_events WHERE id = $1', [stateId]);
      if (state && Date.parse(state.payload.timestamp) >= Date.parse(event.timestamp)) return { stale: true };
      const active = subscription.status === 'active';
      // An old subscription cannot revoke its replacement, or replace another subscription that is still active.
      if (account.dodo_subscription_id && account.dodo_subscription_id !== subscription.subscription_id && (!active || account.plan === 'pro')) return { stale: true };
      await db.query('UPDATE merchant_accounts SET plan = $2, dodo_customer_id = $3, dodo_subscription_id = $4 WHERE id = $1', [accountId, active ? 'pro' : 'free', subscription.customer?.customer_id ?? null, subscription.subscription_id]);
      await db.query('INSERT INTO billing_events (id, provider, type, payload) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload', [stateId, 'dodo', 'subscription.state', { timestamp: event.timestamp, subscriptionId: subscription.subscription_id }]);
      notification = { type: active ? 'billing.merchant_pro' : 'billing.merchant_free', data: { accountId } };
    }
    return { ok: true, type: event.type };
  });
  if (notification) await e.events.emit(notification.type, notification.data);
  return result;
}

export async function creditBalance(e: Engine, apiKeyId: string) {
  const row = await e.db.one<{ credits_usdc: string }>('SELECT credits_usdc::text FROM api_keys WHERE id = $1', [apiKeyId]);
  return toBigInt(row.credits_usdc);
}
