// The seven proof rails. Every rail ends in the same PurchaseClaim; tier A proves the item, tier B only the payment.

export const RAILS = [
  'order_page',
  'order_email',
  'payment_proof',
  'shop_through',
  'merchant_receipt',
  'onchain_payment',
  'network_order',
] as const;

export type Rail = (typeof RAILS)[number];
export type Tier = 'A' | 'B';

export const RAIL_NUMBER: Record<Rail, number> = {
  order_page: 1,
  order_email: 2,
  payment_proof: 3,
  shop_through: 4,
  merchant_receipt: 5,
  onchain_payment: 6,
  network_order: 7,
};

export const RAIL_TIER: Record<Rail, Tier> = {
  order_page: 'A',
  order_email: 'A',
  payment_proof: 'B',
  shop_through: 'B',
  merchant_receipt: 'A',
  onchain_payment: 'A',
  network_order: 'A',
};

export const TIER_NUMBER: Record<Tier, number> = { A: 1, B: 2 };

export const RAIL_INFO: Record<Rail, { label: string; proves: string; how: string }> = {
  order_page: {
    label: 'Order page',
    proves: 'Items, prices, order ID, time',
    how: 'Reclaim zkTLS on the brand’s logged-in order page',
  },
  order_email: {
    label: 'Order email',
    proves: 'Items, amount, order or booking ID',
    how: 'DKIM signature of the order email (ZK Email blueprint, or the forwarded-as-attachment inbox)',
  },
  payment_proof: {
    label: 'Payment proof',
    proves: 'Payee, amount, time',
    how: 'zkTLS on a bank’s or UPI app’s web history',
  },
  shop_through: {
    label: 'Shop-through',
    proves: 'A purchase at that merchant, amount, status',
    how: 'Affiliate network postback after a click on a Receipts link',
  },
  merchant_receipt: {
    label: 'Merchant receipt',
    proves: 'Items, amount',
    how: 'The merchant signs the receipt through the API or prints a QR on the bill',
  },
  onchain_payment: {
    label: 'On-chain payment',
    proves: 'Payment to an agent, API or crypto merchant',
    how: 'The transaction itself (USDC on Base, including x402 payments)',
  },
  network_order: {
    label: 'Network order',
    proves: 'Items, amount',
    how: 'A signed ONDC (Beckn) order callback received as a buyer app',
  },
};

export function railFromNumber(n: number): Rail {
  const rail = RAILS[n - 1];
  if (!rail) throw new Error(`unknown rail number ${n}`);
  return rail;
}

export function tierFromNumber(n: number): Tier {
  if (n === 1) return 'A';
  if (n === 2) return 'B';
  throw new Error(`unknown tier number ${n}`);
}
