import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngine, type Engine } from '../src';
import { createApiKey, creditBalance, creditsCheckout, handleDodoWebhook, merchantCheckout } from '../src/billing';

let e: Engine & { close(): Promise<void> };
let apiKeyId: string;
const secretBytes = Buffer.from('receipts-billing-test-secret');
const secret = `whsec_${secretBytes.toString('base64')}`;
const wallet = '0x1111111111111111111111111111111111111111';

beforeAll(async () => {
  e = await createEngine({
    env: {
      NODE_ENV: 'test', DATABASE_URL: 'pglite:memory', CHAIN: 'off', LLM_PROVIDER: 'offline', DEMO_MODE: 'false',
      DODO_API_KEY: 'test-key', DODO_WEBHOOK_SECRET: secret, DODO_ENV: 'test_mode',
      DODO_PRODUCT_CREDITS: 'pdt_credits', DODO_PRODUCT_MERCHANT_PRO: 'pdt_pro',
    },
    log: { info() {}, warn() {}, error() {}, child() { return this; } },
  });
  await e.db.query("INSERT INTO merchants (id, brand_id, name, source) VALUES ('billing-merchant', 'local', 'Billing Test', 'dashboard')");
});

beforeEach(async () => {
  vi.unstubAllGlobals();
  await e.db.query('DELETE FROM billing_events');
  await e.db.query('DELETE FROM api_keys');
  await e.db.query('DELETE FROM merchant_accounts');
  apiKeyId = (await createApiKey(e, { email: 'buyer@example.com' })).id;
  await e.db.query("INSERT INTO merchant_accounts (id, merchant_id, wallet, claim_method, evidence_hash) VALUES ('account', 'billing-merchant', $1, 'domain', 'evidence')", [wallet]);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await e?.close(); });

function delivery(event: unknown, id = 'evt_test') {
  const raw = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${raw}`).digest('base64');
  return { raw, headers: { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` } };
}

function payment(overrides: Record<string, unknown> = {}) {
  return {
    type: 'payment.succeeded', timestamp: new Date().toISOString(),
    data: {
      payment_id: 'pay_1', status: 'succeeded', metadata: { kind: 'credits', apiKeyId },
      customer: { customer_id: 'cus_buyer' }, product_cart: [{ product_id: 'pdt_credits', quantity: 5 }],
      total_amount: 49_800, currency: 'INR', ...overrides,
    },
  };
}

function subscription(type: string, status: string, timestamp: string, overrides: Record<string, unknown> = {}) {
  return {
    type, timestamp,
    data: { subscription_id: 'sub_1', product_id: 'pdt_pro', status, metadata: { kind: 'merchant_pro', accountId: 'account' }, customer: { customer_id: 'cus_merchant' }, ...overrides },
  };
}

async function receive(event: unknown, id?: string) {
  const { raw, headers } = delivery(event, id);
  return handleDodoWebhook(e, raw, headers);
}

describe('Dodo billing', () => {
  it('grants purchased product units without mistaking INR totals or tax for USD credits', async () => {
    await receive(payment());
    expect(await creditBalance(e, apiKeyId)).toBe(5_000_000n);
  });

  it('fulfills a payment once across concurrent deliveries and distinct event IDs', async () => {
    await Promise.all([receive(payment(), 'evt_1'), receive(payment(), 'evt_1'), receive(payment(), 'evt_2')]);
    expect(await creditBalance(e, apiKeyId)).toBe(5_000_000n);
  });

  it('verifies the raw payload signature and requires the webhook secret', async () => {
    const { raw, headers } = delivery(payment());
    await expect(handleDodoWebhook(e, raw.replace('pay_1', 'pay_changed'), headers)).rejects.toMatchObject({ status: 401 });
    const unconfigured = { ...e, env: { ...e.env, DODO_WEBHOOK_SECRET: undefined } };
    await expect(handleDodoWebhook(unconfigured, raw, headers)).rejects.toMatchObject({ status: 503, code: 'not_configured' });
    expect(await creditBalance(e, apiKeyId)).toBe(0n);
  });

  it('rejects a different product and rolls failed fulfillment back so the same delivery can retry', async () => {
    await expect(receive(payment({ product_cart: [{ product_id: 'pdt_other', quantity: 100 }] }))).rejects.toThrow('Invalid credit payment');
    expect(await e.db.query('SELECT id FROM billing_events')).toHaveLength(0);
    await e.db.query('DELETE FROM api_keys WHERE id = $1', [apiKeyId]);
    const event = payment();
    await expect(receive(event)).rejects.toThrow('Unknown credit account');
    expect(await e.db.query('SELECT id FROM billing_events')).toHaveLength(0);
    await e.db.query("INSERT INTO api_keys (id, key_hash) VALUES ($1, 'restored')", [apiKeyId]);
    await receive(event);
    expect(await creditBalance(e, apiKeyId)).toBe(5_000_000n);
  });

  it('validates checkout amounts, disabled keys and the webhook configuration before charging', async () => {
    const input = { apiKeyId, email: 'buyer@example.com', dollars: 5 };
    await expect(creditsCheckout(e, { ...input, dollars: 1.5 })).rejects.toThrow('whole-dollar');
    await expect(creditsCheckout(e, { ...input, dollars: NaN })).rejects.toThrow('whole-dollar');
    await expect(creditsCheckout(e, { ...input, email: 'invalid' })).rejects.toThrow('valid email');
    await expect(creditsCheckout({ ...e, env: { ...e.env, DODO_WEBHOOK_SECRET: undefined } }, input)).rejects.toMatchObject({ status: 503 });
    await e.db.query('UPDATE api_keys SET disabled = true WHERE id = $1', [apiKeyId]);
    await expect(creditsCheckout(e, input)).rejects.toMatchObject({ status: 403 });
  });

  it('creates typed hosted test checkouts with server-selected products and metadata', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ session_id: 'cks_test', checkout_url: 'https://test.checkout.dodopayments.com/session/cks_test' }), { headers: { 'content-type': 'application/json' } });
    }));
    await expect(creditsCheckout(e, { apiKeyId, email: 'buyer@example.com', dollars: 5 })).resolves.toMatchObject({ sessionId: 'cks_test' });
    expect(requests[0]).toMatchObject({ url: 'https://test.dodopayments.com/checkouts', body: { product_cart: [{ product_id: 'pdt_credits', quantity: 5 }], metadata: { apiKeyId, kind: 'credits' } } });
    await merchantCheckout(e, { accountId: 'account', wallet, email: 'owner@example.com' });
    expect(requests[1]?.body).toMatchObject({ product_cart: [{ product_id: 'pdt_pro', quantity: 1 }], return_url: 'http://localhost:3000/business/billing?checkout=done', metadata: { accountId: 'account', kind: 'merchant_pro' } });
  });

  it('checks business ownership in the engine and refuses a second Pro purchase', async () => {
    await expect(merchantCheckout(e, { accountId: 'account', wallet: '0xother', email: 'owner@example.com' })).rejects.toMatchObject({ status: 403 });
    await e.db.query("UPDATE merchant_accounts SET plan = 'pro' WHERE id = 'account'");
    await expect(merchantCheckout(e, { accountId: 'account', wallet, email: 'owner@example.com' })).rejects.toMatchObject({ status: 409 });
  });

  it('orders subscription events and prevents an old subscription from revoking its replacement', async () => {
    await receive(subscription('subscription.active', 'active', '2026-10-01T00:00:00Z'), 'evt_active');
    await receive(subscription('subscription.cancelled', 'cancelled', '2026-10-02T00:00:00Z'), 'evt_cancel');
    await receive(subscription('subscription.active', 'active', '2026-10-01T00:00:00Z'), 'evt_late');
    expect((await e.db.one("SELECT plan FROM merchant_accounts WHERE id = 'account'")).plan).toBe('free');
    await receive(subscription('subscription.active', 'active', '2026-10-03T00:00:00Z', { subscription_id: 'sub_2' }), 'evt_replaced');
    await receive(subscription('subscription.expired', 'expired', '2026-10-04T00:00:00Z'), 'evt_old_expired');
    expect(await e.db.one("SELECT plan, dodo_subscription_id FROM merchant_accounts WHERE id = 'account'")).toMatchObject({ plan: 'pro', dodo_subscription_id: 'sub_2' });
  });

  it('checks the subscription product and uses current status even on a delayed active event', async () => {
    await expect(receive(subscription('subscription.active', 'active', '2026-10-01T00:00:00Z', { product_id: 'pdt_other' }))).rejects.toThrow('Invalid merchant subscription');
    await receive(subscription('subscription.active', 'cancelled', '2026-10-02T00:00:00Z'));
    expect((await e.db.one("SELECT plan FROM merchant_accounts WHERE id = 'account'")).plan).toBe('free');
  });
});
