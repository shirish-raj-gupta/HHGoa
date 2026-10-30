import { ed25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';
import type { PurchaseClaim } from '@receipts/core';
import { RailError, makeClaim, parseAmountMinor, parseDate } from './claim';

// Rail 7: ONDC network orders. When Receipts runs (or partners with) a buyer app, seller apps send signed Beckn
// callbacks (on_confirm, on_status). We verify the seller's ed25519 signature over the BLAKE2b-512 digest of the
// body, using the public key from the ONDC registry lookup, and accept only completed orders.

export interface BecknAuth {
  subscriberId: string;
  uniqueKeyId: string;
  algorithm: string;
  created: number;
  expires: number;
  headers: string;
  signature: string;
}

export function parseBecknAuthorization(header: string): BecknAuth {
  const get = (k: string) => new RegExp(`${k}="([^"]*)"`).exec(header)?.[1];
  const keyId = get('keyId');
  const [subscriberId, uniqueKeyId, algorithm] = (keyId ?? '').split('|');
  const created = Number(get('created'));
  const expires = Number(get('expires'));
  const signature = get('signature');
  if (!subscriberId || !uniqueKeyId || !signature || !created || !expires) throw new RailError('unparseable', 'malformed Beckn Authorization header');
  return { subscriberId, uniqueKeyId, algorithm: algorithm ?? 'ed25519', created, expires, headers: get('headers') ?? '(created) (expires) digest', signature };
}

export function becknDigest(body: string): string {
  return Buffer.from(blake2b(new TextEncoder().encode(body), { dkLen: 64 })).toString('base64');
}

export function becknSigningString(body: string, created: number, expires: number): string {
  return `(created): ${created}\n(expires): ${expires}\ndigest: BLAKE-512=${becknDigest(body)}`;
}

export function verifyBecknSignature(input: { body: string; authorization: string; publicKeyBase64: string; now?: number }): BecknAuth {
  const auth = parseBecknAuthorization(input.authorization);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (auth.expires < now) throw new RailError('bad_signature', 'Beckn signature expired');
  const message = new TextEncoder().encode(becknSigningString(input.body, auth.created, auth.expires));
  const ok = ed25519.verify(Buffer.from(auth.signature, 'base64'), message, Buffer.from(input.publicKeyBase64, 'base64'));
  if (!ok) throw new RailError('bad_signature', 'Beckn signature did not verify');
  return auth;
}

interface BecknOrder {
  id: string;
  state?: string;
  provider?: { id?: string; descriptor?: { name?: string } };
  items?: { id?: string; descriptor?: { name?: string }; quantity?: { count?: number; selected?: { count?: number } }; price?: { value?: string } }[];
  quote?: { price?: { value?: string; currency?: string } };
  created_at?: string;
  updated_at?: string;
}

export function ondcOrderClaim(input: { body: string; auth: BecknAuth; wallet: string; category?: string }): PurchaseClaim {
  const payload = JSON.parse(input.body) as { context?: { bpp_id?: string; action?: string }; message?: { order?: BecknOrder } };
  const order = payload.message?.order;
  if (!order?.id) throw new RailError('unparseable', 'no order in the callback');
  if (!/^(completed|delivered)$/i.test(order.state ?? '')) throw new RailError('not_completed', `order is ${order.state ?? 'not completed'}`);
  const bpp = payload.context?.bpp_id ?? input.auth.subscriberId;
  return makeClaim({
    rail: 'network_order',
    brandId: 'ondc',
    category: input.category,
    merchant: { name: order.provider?.descriptor?.name ?? bpp, externalId: `${bpp}:${order.provider?.id ?? ''}` },
    items: (order.items ?? []).map((i) => ({
      name: i.descriptor?.name ?? i.id ?? 'item',
      quantity: i.quantity?.selected?.count ?? i.quantity?.count ?? 1,
      priceMinor: parseAmountMinor(i.price?.value) ?? undefined,
    })),
    amountMinor: parseAmountMinor(order.quote?.price?.value) ?? 0,
    purchasedOn: parseDate(order.created_at ?? order.updated_at) ?? new Date().toISOString().slice(0, 10),
    orderRef: order.id,
    nullifierSource: `ondc:${bpp}`,
    boundWallet: input.wallet,
    proof: { kind: 'beckn', body: input.body, auth: input.auth },
    meta: { bpp },
  });
}
