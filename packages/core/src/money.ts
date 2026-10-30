// Money is integers only: USDC in 6-decimal base units, INR in paise. Never floats.

export const USDC_DECIMALS = 6;
export const USDC_UNIT = 1_000_000n;

/** "0.005" -> 5000n */
export function usdcToBase(amount: string | number): bigint {
  const s = typeof amount === 'number' ? amount.toFixed(USDC_DECIMALS) : amount.trim();
  const neg = s.startsWith('-');
  const [whole = '0', frac = ''] = (neg ? s.slice(1) : s).split('.');
  const base = BigInt(whole || '0') * USDC_UNIT + BigInt((frac + '000000').slice(0, USDC_DECIMALS) || '0');
  return neg ? -base : base;
}

/** 5000n -> "0.005" */
export function baseToUsdc(base: bigint | number | string): string {
  let b = BigInt(base);
  const neg = b < 0n;
  if (neg) b = -b;
  const whole = b / USDC_UNIT;
  const frac = (b % USDC_UNIT).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

export function formatInr(paise: number | bigint): string {
  const p = Number(paise);
  return `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: p % 100 === 0 ? 0 : 2 })}`;
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** basis points of an amount, rounded down */
export function bps(amount: bigint, basisPoints: number): bigint {
  return (amount * BigInt(basisPoints)) / 10_000n;
}

/**
 * Reviewers are paid only by citation: 70% of agent and card money and 30% of commissions go to the reviews that
 * answers cited. Commissions also fund buyer cashback. No reviewer is ever paid for a sale.
 */
export const SPLITS = {
  agent: { reviewers: 7000, receipts: 3000 },
  card: { reviewers: 7000, receipts: 3000 },
  commission: { buyer: 5000, reviewers: 3000, receipts: 2000 },
} as const;

/** Prices per paid tool / endpoint, in USDC. */
export const PRICES_USDC = {
  search_receipts: '0.005',
  get_item_reputation: '0.002',
  get_merchant_reputation: '0.002',
} as const;
export type PaidTool = keyof typeof PRICES_USDC;

/**
 * Split `total` across weights so the parts sum exactly to `total` (largest remainder method).
 * Weights need not be normalised.
 */
export function splitByWeight<T extends { weight: number }>(total: bigint, parts: readonly T[]): (T & { amount: bigint })[] {
  const sum = parts.reduce((s, p) => s + Math.max(0, p.weight), 0);
  if (parts.length === 0 || sum <= 0 || total <= 0n) return parts.map((p) => ({ ...p, amount: 0n }));
  const SCALE = 1_000_000_000n;
  const exact = parts.map((p) => (total * BigInt(Math.round((Math.max(0, p.weight) / sum) * Number(SCALE)))));
  const floors = exact.map((e) => e / SCALE);
  let remainder = total - floors.reduce((s, f) => s + f, 0n);
  const order = exact
    .map((e, i) => ({ i, frac: e % SCALE }))
    .sort((a, b) => (b.frac > a.frac ? 1 : b.frac < a.frac ? -1 : 0));
  const amounts = [...floors];
  for (let k = 0; remainder > 0n; k = (k + 1) % order.length, remainder--) amounts[order[k]!.i]! += 1n;
  // Rounding of the scaled weights can leave a tiny negative remainder; take it from the largest part.
  if (remainder < 0n) {
    const maxI = amounts.reduce((mi, a, i, arr) => (a > arr[mi]! ? i : mi), 0);
    amounts[maxI]! += remainder;
  }
  return parts.map((p, i) => ({ ...p, amount: amounts[i]! }));
}
