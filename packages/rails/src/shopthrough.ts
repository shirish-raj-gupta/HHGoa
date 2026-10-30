import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PurchaseClaim } from '@receipts/core';
import { RailError, makeClaim, parseAmountMinor } from './claim';

// Rail 4: shop-through (the CashKaro model). A "Buy via Receipts" click carries our click ID to the affiliate
// network; the network posts back order ID, amount, commission and status. Tier B: it proves a purchase at that
// merchant, not the item. Items come from rail 1 or 2 if the buyer adds them later.
//
// Field names differ per network and campaign. The defaults below are starting points; confirm them with each
// network's test conversion during prep and override with AFFILIATE_FIELDS_<NETWORK> (JSON) if needed.

export type Network = 'cuelinks' | 'admitad' | 'inrdeals' | 'direct' | 'test';

export interface PostbackFields {
  clickId: string[];
  orderId: string[];
  amount: string[];
  commission: string[];
  status: string[];
  currency: string[];
}

export const DEFAULT_FIELDS: Record<Network, PostbackFields> = {
  cuelinks: {
    clickId: ['subid', 'sub_id', 'aff_sub'],
    orderId: ['order_id', 'transaction_id', 'txn_id'],
    amount: ['sale_amount', 'order_amount', 'amount'],
    commission: ['commission', 'payout', 'user_commission'],
    status: ['status'],
    currency: ['currency'],
  },
  admitad: {
    clickId: ['subid', 'subid1', 'sub_id'],
    orderId: ['order_id', 'action_id'],
    amount: ['order_sum', 'cart', 'amount'],
    commission: ['payment_sum', 'payment', 'reward'],
    status: ['payment_status', 'status'],
    currency: ['currency'],
  },
  inrdeals: {
    clickId: ['subid', 'sub_id', 'aff_sub1'],
    orderId: ['order_id', 'transaction_id'],
    amount: ['sale_amount', 'order_value', 'amount'],
    commission: ['commission', 'payout'],
    status: ['status', 'conversion_status'],
    currency: ['currency'],
  },
  direct: {
    clickId: ['click_id', 'subid'],
    orderId: ['order_id'],
    amount: ['amount', 'order_total'],
    commission: ['commission'],
    status: ['status'],
    currency: ['currency'],
  },
  test: {
    clickId: ['click_id', 'subid'],
    orderId: ['order_id'],
    amount: ['amount'],
    commission: ['commission'],
    status: ['status'],
    currency: ['currency'],
  },
};

export type ConversionStatus = 'pending' | 'confirmed' | 'cancelled';

export function normaliseStatus(raw: string | undefined): ConversionStatus {
  const s = (raw ?? '').toLowerCase();
  if (/^(approved|confirmed|paid|validated|accepted|1)$/.test(s)) return 'confirmed';
  if (/^(declined|rejected|cancel+ed|reversed|refunded|invalid|2)$/.test(s)) return 'cancelled';
  return 'pending';
}

export interface Postback {
  network: Network;
  clickId: string;
  orderId: string;
  amountMinor: number | null;
  commissionMinor: number | null;
  currency: string;
  status: ConversionStatus;
  raw: Record<string, string>;
}

function get(params: Record<string, string>, names: string[]): string | undefined {
  for (const n of names) if (params[n] !== undefined && params[n] !== '') return params[n];
  return undefined;
}

/**
 * Check the network's shared secret (a `secret`/`token` parameter, or an HMAC-SHA256 of the raw body in
 * x-signature) and read the conversion.
 */
export function parsePostback(input: {
  network: Network;
  params: Record<string, string>;
  rawBody?: string;
  headers?: Record<string, string | undefined>;
  secret: string;
  fields?: Partial<PostbackFields>;
}): Postback {
  const { params, secret } = input;
  if (!secret) throw new RailError('not_configured', `no postback secret configured for ${input.network}`);
  const given = params.secret ?? params.token ?? params.key;
  const sig = input.headers?.['x-signature'] ?? input.headers?.['x-hub-signature-256'];
  let ok = false;
  if (given) ok = safeEqual(given, secret);
  else if (sig && input.rawBody !== undefined) {
    const expected = createHmac('sha256', secret).update(input.rawBody).digest('hex');
    ok = safeEqual(sig.replace(/^sha256=/, ''), expected);
  }
  if (!ok) throw new RailError('bad_signature', 'postback secret or signature did not match');

  const f = { ...DEFAULT_FIELDS[input.network], ...input.fields };
  const clickId = get(params, f.clickId);
  const orderId = get(params, f.orderId);
  if (!clickId || !orderId) throw new RailError('unparseable', 'postback is missing the click ID or order ID');
  return {
    network: input.network,
    clickId,
    orderId,
    amountMinor: parseAmountMinor(get(params, f.amount)),
    commissionMinor: parseAmountMinor(get(params, f.commission)),
    currency: (get(params, f.currency) ?? 'INR').toUpperCase(),
    status: normaliseStatus(get(params, f.status)),
    raw: Object.fromEntries(Object.entries(params).filter(([k]) => !['secret', 'token', 'key'].includes(k))),
  };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The tier B purchase claim a conversion creates for the buyer who clicked. */
export function shopThroughClaim(pb: Postback, ctx: { brandId: string; merchantName: string; wallet: string; category?: string; test?: boolean }): PurchaseClaim {
  return makeClaim({
    rail: 'shop_through',
    brandId: ctx.brandId,
    category: ctx.category,
    merchant: { name: ctx.merchantName },
    items: [],
    amountMinor: pb.amountMinor ?? 0,
    currency: pb.currency === 'INR' ? 'INR' : 'USD',
    purchasedOn: new Date().toISOString().slice(0, 10),
    orderRef: pb.orderId,
    nullifierSource: `shop:${pb.network}`,
    boundWallet: ctx.wallet,
    proof: { kind: 'postback', network: pb.network, clickId: pb.clickId, orderId: pb.orderId, status: pb.status },
    status: pb.status,
    simulated: ctx.test ?? false,
    meta: { network: pb.network, clickId: pb.clickId, testConversion: ctx.test ?? false },
  });
}
