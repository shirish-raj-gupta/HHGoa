import type { PurchaseClaim, PurchaseItem, Rail } from '@receipts/core';
import { makeClaim } from './claim';

// The dev rail: a labelled, simulated purchase for local development and rehearsals without provider accounts.
// Claims are always simulated = true, every screen labels them, and the API refuses this rail unless
// ALLOW_SIMULATED_PROOFS=true.

export function simulatedClaim(input: {
  wallet: string;
  rail?: Rail;
  brandId: string;
  category?: string;
  merchantName: string;
  cityId?: string;
  lat?: number;
  lng?: number;
  items: PurchaseItem[];
  amountMinor?: number;
  purchasedOn?: string;
  orderRef?: string;
}): PurchaseClaim {
  const orderRef = input.orderRef ?? `sim-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return makeClaim({
    rail: input.rail ?? 'order_page',
    brandId: input.brandId,
    category: input.category,
    merchant: { name: input.merchantName, cityId: input.cityId, lat: input.lat, lng: input.lng },
    items: input.items,
    amountMinor: input.amountMinor ?? input.items.reduce((s, i) => s + (i.priceMinor ?? 0) * (i.quantity ?? 1), 0),
    purchasedOn: input.purchasedOn ?? new Date().toISOString().slice(0, 10),
    orderRef,
    nullifierSource: `sim:${input.brandId}`,
    boundWallet: input.wallet,
    proof: { kind: 'simulated', orderRef, note: 'Simulated proof for development and rehearsals. Not a real purchase.' },
    simulated: true,
    meta: { simulated: true },
  });
}
