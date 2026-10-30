import type { Rail } from '@receipts/core';

// Reclaim providers we use, from Reclaim's public directory (25,089 providers on 2026-10-29; 22,464 of them are
// universities). Only these extract enough of a purchase to review it. They are community providers unless marked
// verified: we read each one's config (which page it proves, which values it takes), but a provider is only known to
// work once a real order has gone through it, so each brand rail stays "testing" until then.
//
// `fields` maps our names (the canonical names in packages/rails/src/reclaim.ts) to the provider's own variable
// names. An env var RECLAIM_PROVIDER_<BRAND> overrides the provider for a brand, for one built in the Reclaim devtool.

export type ReclaimField = 'orderId' | 'items' | 'itemPrices' | 'total' | 'merchantName' | 'orderTime' | 'status' | 'upiRef' | 'payeeName' | 'payeeVpa' | 'amount' | 'txnTime';

export interface ReclaimProvider {
  id: string;
  brandId: string;
  rail: Extract<Rail, 'order_page' | 'payment_proof'>;
  /** Its name in Reclaim's directory. */
  name: string;
  /** Verified by Reclaim; otherwise a community provider whose config we read on `checked`. */
  verified: boolean;
  checked: string;
  /** What a proof from it carries, in plain words, shown before the reviewer starts. */
  proves: string;
  fields: Partial<Record<ReclaimField, string>>;
  /** Anything else it takes about the person. The proof is stored encrypted and these are never shown. */
  alsoShares?: string;
}

export const RECLAIM_PROVIDERS: ReclaimProvider[] = [
  {
    id: '8aac5893-f43b-4fd9-ad26-ae266da258d2',
    brandId: 'swiggy',
    rail: 'order_page',
    name: 'Swiggy Last Order Details',
    verified: false,
    checked: '2026-10-29',
    proves: 'your latest Swiggy order: the restaurant, the dishes and the total (not the order number)',
    fields: { merchantName: 'restaurant_name', status: 'order_delivery_status', total: 'net_total', items: 'order_items' },
  },
  {
    id: '24dbc5f4-b97a-4f9e-a6dc-4a4b9bf804eb',
    brandId: 'instamart',
    rail: 'order_page',
    name: 'Hackon - Aditya (Swiggy Instamart orders)',
    verified: false,
    checked: '2026-10-29',
    proves: 'your latest Instamart order: its number and amount (not the items)',
    fields: { orderId: 'order_id', total: 'amount' },
  },
  {
    id: '675fa687-4e5b-45ec-b560-ec8cd61174eb',
    brandId: 'blinkit',
    rail: 'order_page',
    name: 'Blinkit Last 3 Orders',
    verified: false,
    checked: '2026-10-29',
    proves: 'your latest Blinkit order: its number, amount and date (not the items)',
    fields: { orderId: 'order1_id', total: 'order1_amount', orderTime: 'order1_date', status: 'order1_status' },
  },
  {
    id: '46538f0f-d672-4eb0-bae2-da4feaa02b22',
    brandId: 'jiomart',
    rail: 'order_page',
    name: 'JioMart Order Details + Profile',
    verified: false,
    checked: '2026-10-29',
    proves: 'your latest JioMart order: the first product, the amount and the date',
    fields: { items: 'product_name', total: 'order_amount', orderTime: 'purchased_date' },
    alsoShares: 'your name, email and mobile number',
  },
  {
    id: '1d270ba2-8680-415b-b7e2-2cebd47f6f02',
    brandId: 'amazon',
    rail: 'order_page',
    name: 'Amazon Orders A',
    verified: false,
    checked: '2026-10-29',
    proves: 'that your latest Amazon.in order exists, by its order number (not what it was)',
    fields: { orderId: 'order_id_1' },
  },
  {
    id: '7440d107-65f4-47d5-925c-c4b6eeebe5b5',
    brandId: 'nike',
    rail: 'order_page',
    name: 'Nike Last Order',
    verified: false,
    checked: '2026-10-29',
    proves: 'your latest Nike order: the product, its order number and date',
    fields: { orderId: 'order_id', items: 'item', orderTime: 'date' },
  },
  {
    id: 'eed85427-95dd-474e-91a5-945f25c78c26',
    brandId: 'kfc',
    rail: 'order_page',
    name: 'Kfc last order data',
    verified: false,
    checked: '2026-10-29',
    proves: 'your latest KFC order: the first item, its price and the date',
    fields: { items: 'itemName', itemPrices: 'itemPrice', orderTime: 'Date' },
  },
  {
    id: 'f0a8cd0f-1e41-496f-a8bc-7ea1341fbeac',
    brandId: 'paytm',
    rail: 'order_page',
    name: 'Paytm Last Order Detail',
    verified: false,
    checked: '2026-10-29',
    proves: 'your latest Paytm order (a recharge, bill or ticket): what it was, its number, amount and date',
    fields: { orderId: 'order_id', items: 'order_name', total: 'amount', status: 'status', orderTime: 'dateString' },
  },
  {
    id: '789c875f-8348-4a5c-873a-4aa02146b1e0',
    brandId: 'netflix',
    rail: 'order_page',
    name: 'Netflix Subscription Plan',
    verified: false,
    checked: '2026-10-29',
    proves: 'which Netflix plan you pay for now (not since when, or the price)',
    fields: { items: 'Netflix_Plan' },
  },
  {
    // Chosen over 9f08ce07 (Uber Basic Info & Last Ride), which reads the same fare plus name, email, phone and rating.
    id: '29b27359-9416-42c6-bc7d-86ddc2edd701',
    brandId: 'uber',
    rail: 'order_page',
    name: 'Uber Last Ride',
    verified: false,
    checked: '2026-10-29',
    proves: 'the fare of your latest Uber ride (not the date or the route)',
    fields: { total: 'description' },
  },
];

/** The provider behind a proof, by its Reclaim ID. */
export function reclaimProvider(id: string | null | undefined): ReclaimProvider | null {
  return RECLAIM_PROVIDERS.find((p) => p.id === id) ?? null;
}

/** The default provider for a brand's rail, if the directory has one we can read. */
export function defaultReclaimProvider(brandId: string, rail: Rail): ReclaimProvider | null {
  return RECLAIM_PROVIDERS.find((p) => p.brandId === brandId && p.rail === rail) ?? null;
}
