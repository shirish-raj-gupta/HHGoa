import { ReclaimProofRequest, verifyProof, type Proof } from '@reclaimprotocol/js-sdk';
import { keccak256, toBytes } from 'viem';
import type { PurchaseClaim, PurchaseItem } from '@receipts/core';
import { RailError, makeClaim, parseAmountMinor, parseDate, sameWallet } from './claim';

// Rails 1 (order page) and 3 (payment proof): Reclaim zkTLS on a logged-in page. The user logs in inside Reclaim's
// flow; credentials never reach us. The wallet and review session are signed into the proof as its context.
//
// Custom providers built in the Reclaim developer portal should extract these canonical fields (community
// providers are mapped through the aliases below):
//   order page:    orderId, merchantName, merchantId, items, itemPrices, total, orderTime, address
//   payment proof: upiRef, payeeName, payeeVpa, amount, txnTime   (landlords: payments = JSON [{amount,date,ref}])

export interface ReclaimAppConfig {
  appId: string;
  appSecret: string;
}

export interface StartedReclaimRequest {
  requestJson: string;
  /** Reclaim's browser portal: log in to the brand in a live browser, on this device. About 1,600 characters. */
  requestUrl: string;
  /** The same request as a short link for a QR code (Reclaim's phone flow), or requestUrl if shortening failed. */
  /** Reclaim's short link to its phone flow, which opens the Reclaim verifier app. */
  appUrl: string;
  providerId: string;
  providerVersion: string | null;
  /** Reclaim's own session ID: where the proofs wait when there is no callback of ours (fetchReclaimSession). */
  reclaimSessionId: string;
}

const RECLAIM_API = 'https://api.reclaimprotocol.org';

/** Backend: create the request and bind the wallet and session into it. With a callback URL Reclaim posts the proofs
 *  there; without one (a server Reclaim cannot reach, like localhost) it keeps them until fetchReclaimSession. */
export async function startReclaimRequest(
  app: ReclaimAppConfig,
  p: { providerId: string; wallet: string; sessionId: string; callbackUrl: string | null },
): Promise<StartedReclaimRequest> {
  const req = await ReclaimProofRequest.init(app.appId, app.appSecret, p.providerId, { canAutoSubmit: true });
  req.setContext(p.wallet.toLowerCase(), p.sessionId);
  if (p.callbackUrl) req.setAppCallbackUrl(p.callbackUrl, true);
  const version = req.getProviderVersion();
  const requestJson = req.toJsonString();
  const requestUrl = await req.getRequestUrl();
  return {
    requestJson,
    requestUrl,
    appUrl: await shortLink(requestUrl),
    providerId: p.providerId,
    providerVersion: version.providerVersion || null,
    reclaimSessionId: String((JSON.parse(requestJson) as { sessionId: string }).sessionId),
  };
}

/** A QR code of the 1,600-character portal link needs about 137 squares a side, which no camera reads off a screen.
 *  Reclaim shortens links to its phone flow (its verifier app; it refuses portal links): about 90 characters. */
async function shortLink(requestUrl: string): Promise<string> {
  const template = requestUrl.split('?template=')[1];
  if (!template) return requestUrl;
  try {
    const res = await fetch(`${RECLAIM_API}/api/sdk/shortener`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullUrl: `https://share.reclaimprotocol.org/verifier/?template=${template}` }),
      signal: AbortSignal.timeout(8000),
    });
    const short = ((await res.json()) as { result?: { shortUrl?: string } }).result?.shortUrl;
    return res.ok && short && short.length < 300 ? short : requestUrl;
  } catch {
    return requestUrl;
  }
}

/** Where a session stands at Reclaim, and its proofs once submitted (only kept there when we set no callback). */
export async function fetchReclaimSession(reclaimSessionId: string): Promise<{ status: string; proofs: Proof[]; error: string | null }> {
  const res = await fetch(`${RECLAIM_API}/api/sdk/session/${encodeURIComponent(reclaimSessionId)}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new RailError('not_verified', `Reclaim did not return the session (${res.status})`);
  const s = ((await res.json()) as { session?: { statusV2?: string; proofs?: Proof[]; error?: { message?: string } } }).session;
  return { status: s?.statusV2 ?? 'UNKNOWN', proofs: s?.proofs ?? [], error: s?.error?.message ?? null };
}

/** Reclaim posts proofs to the callback as JSON (jsonProofResponse) or URL-encoded JSON; accept both. */
export function parseReclaimCallbackBody(body: string): Proof[] {
  const text = body.trim().startsWith('{') || body.trim().startsWith('[') ? body : decodeURIComponent(body);
  const parsed = JSON.parse(text) as unknown;
  const list = Array.isArray(parsed) ? parsed : (parsed as { proofs?: unknown[] }).proofs ?? [parsed];
  return list as Proof[];
}

/** Verify signatures and content against the provider, then check the proof is bound to this wallet and session (and,
 *  when known, to the Reclaim session we started: the SDK leaves replay checks to the caller). */
export async function verifyReclaimProofs(
  proofs: Proof[],
  expected: { providerId: string; providerVersion?: string | null; wallet: string; sessionId: string; reclaimSessionId?: string | null },
): Promise<{ params: Record<string, string>; timestampS: number }[]> {
  if (proofs.length === 0) throw new RailError('not_verified', 'no proofs in callback');
  const result = await verifyProof(proofs, { providerId: expected.providerId, providerVersion: expected.providerVersion ?? undefined });
  if (!result.isVerified) throw new RailError('not_verified', result.error?.message ?? 'Reclaim proof did not verify');
  return result.data.map((d, i) => {
    const ctx = d.context as { contextAddress?: string; contextMessage?: string; reclaimSessionId?: string };
    if (!sameWallet(ctx.contextAddress, expected.wallet)) throw new RailError('wallet_mismatch', 'proof is bound to a different wallet');
    if (ctx.contextMessage !== expected.sessionId) throw new RailError('session_mismatch', 'proof belongs to a different review session');
    if (expected.reclaimSessionId && ctx.reclaimSessionId && ctx.reclaimSessionId !== expected.reclaimSessionId) {
      throw new RailError('session_mismatch', 'proof comes from a different Reclaim session');
    }
    return { params: d.extractedParameters, timestampS: proofs[i]?.claimData.timestampS ?? Math.floor(Date.now() / 1000) };
  });
}

function pick(params: Record<string, string>, names: string[]): string | undefined {
  for (const n of names) {
    const v = params[n] ?? params[n.toLowerCase()];
    if (v !== undefined && v !== '') return v;
  }
  const lower = Object.fromEntries(Object.entries(params).map(([k, v]) => [k.toLowerCase().replace(/[_\s-]/g, ''), v]));
  for (const n of names) {
    const v = lower[n.toLowerCase().replace(/[_\s-]/g, '')];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

function list(raw: string | undefined): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return raw.split(/\s*(?:\||\n|;)\s*/).filter(Boolean);
}

export function parseItems(itemsRaw: string | undefined, pricesRaw?: string): PurchaseItem[] {
  const names = list(itemsRaw);
  const prices = list(pricesRaw);
  return names
    .map((n, i): PurchaseItem | null => {
      if (typeof n === 'object' && n !== null) {
        const o = n as Record<string, unknown>;
        const name = String(o.name ?? o.itemName ?? o.title ?? '').trim();
        if (!name) return null;
        const quantity = Number(o.quantity ?? o.qty ?? 1) || 1;
        const priceMinor = parseAmountMinor((o.price ?? o.amount ?? o.total) as string | number | undefined) ?? undefined;
        return { name, quantity, priceMinor, variant: o.variant ? String(o.variant) : undefined };
      }
      const s = String(n).trim();
      const qty = /^(\d+)\s*[x×]\s*(.+)$/i.exec(s);
      return {
        name: (qty ? qty[2]! : s).trim(),
        quantity: qty ? Number(qty[1]) : 1,
        priceMinor: parseAmountMinor(prices[i] as string | undefined) ?? undefined,
      };
    })
    .filter((x): x is PurchaseItem => !!x && x.name.length > 0);
}

/** What the engine knows about the provider: its field map (our name -> its variable) and the brand's name, for
 *  providers that do not extract the merchant (a brand's own shop: Nike, KFC). */
export interface ReclaimClaimContext {
  brandId: string;
  wallet: string;
  category?: string;
  providerId: string;
  proof: unknown;
  cityId?: string;
  fields?: Partial<Record<string, string>>;
  merchantFallback?: string;
}

/** The provider's own variable names, copied under ours. */
function withFields(params: Record<string, string>, fields: ReclaimClaimContext['fields']): Record<string, string> {
  const out = { ...params };
  for (const [ours, theirs] of Object.entries(fields ?? {})) {
    const v = theirs ? params[theirs] : undefined;
    if (v !== undefined && v !== '') out[ours] = v;
  }
  return out;
}

/** Item names are published: hide runs of six or more digits (phone, account and card numbers in order names). */
const maskDigits = (name: string) => name.replace(/\d[\d\s-]{4,}\d/g, (m) => (m.replace(/\D/g, '').length >= 6 ? '••••' : m));

/** Rail 1: an order on a brand's logged-in order page. Tier A when the items are proven, else B. */
export function orderPageClaim(proved: { params: Record<string, string>; timestampS: number }, ctx: ReclaimClaimContext): PurchaseClaim {
  const p = withFields(proved.params, ctx.fields);
  // order1* is the newest order from providers that prove the last few (Blinkit "Last 3 Orders").
  const status = pick(p, ['orderStatus', 'order_status', 'orderDeliveryStatus', 'order1Status', 'status']);
  if (status && /cancel|fail|reject/i.test(status)) throw new RailError('not_completed', `the order was ${status.toLowerCase()}`);
  const items = parseItems(pick(p, ['items', 'itemNames', 'item_names', 'dishes', 'products', 'orderItems']), pick(p, ['itemPrices', 'item_prices', 'prices'])).map((i) => ({
    ...i,
    name: maskDigits(i.name),
  }));
  const total = parseAmountMinor(pick(p, ['total', 'orderTotal', 'order_total', 'grandTotal', 'billTotal', 'totalAmount', 'netTotal', 'order1Amount', 'amount']));
  const merchantName = pick(p, ['merchantName', 'restaurantName', 'restaurant_name', 'restaurant', 'storeName', 'sellerName', 'merchant', 'hotelName']);
  const seller = merchantName ?? ctx.merchantFallback ?? ctx.brandId;
  const when = pick(p, ['orderTime', 'order_time', 'orderedAt', 'ordered_at', 'orderDate', 'order_date', 'order1Date', 'date', 'timestamp']);
  // Some community providers prove the latest order without its ID (Swiggy "Last Order Details"). Then the reference
  // is this wallet plus what was ordered (and when, if the provider says), so one reviewer cannot review it twice,
  // though a second person on the same account could. A provider that extracts the order ID keys it per order.
  const orderId =
    pick(p, ['orderId', 'order_id', 'orderID', 'orderNumber', 'order_number', 'order1Id', 'id']) ??
    (items.length || total
      ? `latest:${keccak256(toBytes(JSON.stringify([ctx.wallet.toLowerCase(), seller, items.map((i) => [i.quantity, i.name]), total, when ?? null])))}`
      : undefined);
  if (!orderId) throw new RailError('unparseable', 'the provider did not extract an order ID');
  const purchasedOn = parseDate(when) ?? new Date(proved.timestampS * 1000).toISOString().slice(0, 10);
  return makeClaim({
    rail: 'order_page',
    brandId: ctx.brandId,
    category: ctx.category,
    merchant: {
      name: seller,
      externalId: pick(p, ['merchantId', 'restaurantId', 'restaurant_id', 'storeId', 'outletId', 'sellerId']),
      address: pick(p, ['address', 'restaurantAddress', 'locality', 'area']),
      cityId: ctx.cityId,
    },
    items,
    amountMinor: total ?? items.reduce((s, i) => s + (i.priceMinor ?? 0) * i.quantity, 0),
    purchasedOn,
    orderRef: orderId,
    nullifierSource: ctx.brandId,
    boundWallet: ctx.wallet,
    proof: ctx.proof,
    tier: items.length ? undefined : 'B',
    meta: { providerId: ctx.providerId, proofTimestampS: proved.timestampS },
  });
}

/** Rail 3: a payment in a bank or UPI app's web history. Tier B: proves the payee, not the item. */
export function paymentProofClaim(proved: { params: Record<string, string>; timestampS: number }, ctx: ReclaimClaimContext): PurchaseClaim {
  const p = withFields(proved.params, ctx.fields);
  const payments = list(pick(p, ['payments'])) as { amount?: string; date?: string; ref?: string }[];
  const upiRef = pick(p, ['upiRef', 'utr', 'rrn', 'upi_ref', 'upiTransactionId', 'transactionId', 'txnId', 'referenceId', 'refId']) ?? payments[0]?.ref;
  if (!upiRef) throw new RailError('unparseable', 'the provider did not extract a UPI reference');
  const payeeName = pick(p, ['payeeName', 'payee', 'merchantName', 'toName', 'beneficiary', 'paidTo']);
  const payeeVpa = pick(p, ['payeeVpa', 'vpa', 'upiId', 'toVpa', 'payee_vpa']);
  const amount = parseAmountMinor(pick(p, ['amount', 'txnAmount', 'total']) ?? payments[0]?.amount);
  const purchasedOn = parseDate(pick(p, ['txnTime', 'transactionDate', 'date', 'time', 'timestamp']) ?? payments[0]?.date) ??
    new Date(proved.timestampS * 1000).toISOString().slice(0, 10);
  if (!payeeName && !payeeVpa) throw new RailError('unparseable', 'the provider did not extract the payee');
  const meta: Record<string, unknown> = { providerId: ctx.providerId, proofTimestampS: proved.timestampS };
  if (payments.length) {
    const dates = payments.map((x) => parseDate(x.date)).filter((d): d is string => !!d).sort();
    meta.payments = payments.length;
    meta.spanMonths = dates.length > 1 ? Math.round((Date.parse(dates.at(-1)!) - Date.parse(dates[0]!)) / (30.44 * 86_400_000)) : 0;
  }
  return makeClaim({
    rail: 'payment_proof',
    brandId: ctx.brandId,
    category: ctx.category,
    merchant: { name: payeeName ?? payeeVpa!, upiVpa: payeeVpa?.toLowerCase(), cityId: ctx.cityId },
    items: [],
    amountMinor: amount ?? 0,
    purchasedOn,
    orderRef: upiRef.replace(/\s+/g, ''),
    nullifierSource: 'upi',
    boundWallet: ctx.wallet,
    proof: ctx.proof,
    meta,
  });
}
