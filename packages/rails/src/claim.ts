import {
  PurchaseClaim,
  RAIL_TIER,
  proofHashOf,
  purchaseNullifier,
  type MerchantRef,
  type PurchaseItem,
  type Rail,
  type Tier,
} from '@receipts/core';

export class RailError extends Error {
  constructor(
    readonly code:
      | 'not_verified'
      | 'wallet_mismatch'
      | 'session_mismatch'
      | 'unknown_brand'
      | 'unparseable'
      | 'too_old'
      | 'not_completed'
      | 'bad_signature'
      | 'not_configured'
      | 'not_allowed',
    message: string,
  ) {
    super(message);
    this.name = 'RailError';
  }
}

export interface ClaimInput {
  rail: Rail;
  brandId: string;
  category?: string;
  merchant: MerchantRef;
  items: PurchaseItem[];
  amountMinor: number;
  currency?: 'INR' | 'USD' | 'USDC';
  purchasedOn: string;
  orderRef: string;
  /** What the nullifier hashes with the order reference: the brand, "upi", "receipt:<merchantId>", "tx:<chainId>"... */
  nullifierSource: string;
  boundWallet: string;
  proof: unknown;
  /** Defaults to the rail's tier; a rail that usually proves the items says B when this proof did not. */
  tier?: Tier;
  status?: PurchaseClaim['status'];
  simulated?: boolean;
  meta?: Record<string, unknown>;
}

/** Every rail ends here: one PurchaseClaim with its nullifier and proof hash. */
export function makeClaim(input: ClaimInput): PurchaseClaim {
  return PurchaseClaim.parse({
    rail: input.rail,
    tier: input.tier ?? RAIL_TIER[input.rail],
    brandId: input.brandId,
    category: input.category,
    merchant: input.merchant,
    items: input.items,
    amountMinor: input.amountMinor,
    currency: input.currency ?? 'INR',
    purchasedOn: input.purchasedOn,
    orderRef: input.orderRef,
    nullifier: purchaseNullifier(input.nullifierSource, input.orderRef),
    boundWallet: input.boundWallet.toLowerCase(),
    proofHash: proofHashOf(input.proof),
    status: input.status ?? 'confirmed',
    simulated: input.simulated ?? false,
    meta: input.meta ?? {},
    proof: input.proof,
  });
}

/** "₹ 1,412.50", "Rs.412", "412.5" -> paise. */
export function parseAmountMinor(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Math.round(raw * 100);
  const m = /(-?\d[\d,]*(?:\.\d{1,2})?)/.exec(raw.replace(/\s+/g, ''));
  if (!m) return null;
  return Math.round(Number(m[1]!.replace(/,/g, '')) * 100);
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Best-effort date parsing for the formats brands use. Returns YYYY-MM-DD or null. */
export function parseDate(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' || /^\d{10,13}$/.test(String(raw))) {
    const n = Number(raw);
    return new Date(n < 1e12 ? n * 1000 : n).toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[\s/\-.]+([A-Za-z]{3,9}|\d{1,2})[\s/\-.,]+(\d{2,4})/.exec(s);
  if (dmy) {
    const day = Number(dmy[1]);
    const mon = /^\d+$/.test(dmy[2]!) ? Number(dmy[2]) - 1 : MONTHS[dmy[2]!.slice(0, 3).toLowerCase()];
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    if (mon !== undefined && mon >= 0 && mon < 12) return new Date(Date.UTC(year, mon, day)).toISOString().slice(0, 10);
  }
  const mdy = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (mdy) {
    const mon = MONTHS[mdy[1]!.slice(0, 3).toLowerCase()];
    if (mon !== undefined) return new Date(Date.UTC(Number(mdy[3]), mon, Number(mdy[2]))).toISOString().slice(0, 10);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

export function sameWallet(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
