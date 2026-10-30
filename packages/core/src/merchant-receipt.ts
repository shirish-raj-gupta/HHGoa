import { keccak256, toBytes, type Hex } from 'viem';
import { canonicalJson } from './cid';

// Rail 5: a merchant signs each receipt (EIP-712) through the API or prints it as a QR on the bill.

export const MERCHANT_RECEIPT_DOMAIN = { name: 'Receipts Merchant Receipt', version: '1' } as const;

export const MERCHANT_RECEIPT_TYPES = {
  MerchantReceipt: [
    { name: 'merchantId', type: 'bytes32' },
    { name: 'receiptId', type: 'bytes32' },
    { name: 'amountMinor', type: 'uint256' },
    { name: 'currency', type: 'string' },
    { name: 'itemsHash', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint64' },
  ],
} as const;

export interface MerchantReceiptItem {
  name: string;
  qty: number;
  priceMinor: number;
}

export interface MerchantReceipt {
  merchantId: Hex;
  receiptId: Hex;
  amountMinor: number;
  currency: string;
  items: MerchantReceiptItem[];
  /** unix seconds */
  issuedAt: number;
  signature: Hex;
}

export function receiptItemsHash(items: readonly MerchantReceiptItem[]): Hex {
  return keccak256(toBytes(canonicalJson(items.map((i) => ({ name: i.name, qty: i.qty, priceMinor: i.priceMinor })))));
}

export function merchantReceiptTypedData(r: Omit<MerchantReceipt, 'signature'>) {
  return {
    domain: MERCHANT_RECEIPT_DOMAIN,
    types: MERCHANT_RECEIPT_TYPES,
    primaryType: 'MerchantReceipt' as const,
    message: {
      merchantId: r.merchantId,
      receiptId: r.receiptId,
      amountMinor: BigInt(r.amountMinor),
      currency: r.currency,
      itemsHash: receiptItemsHash(r.items),
      issuedAt: BigInt(r.issuedAt),
    },
  };
}

function toBase64Url(s: string): string {
  const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return typeof atob === 'function' ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, 'base64').toString('utf8');
}

/** Compact QR payload: base64url of the canonical JSON. */
export function encodeReceiptQr(r: MerchantReceipt): string {
  return toBase64Url(canonicalJson(r));
}

export function decodeReceiptQr(payload: string): MerchantReceipt {
  const raw = payload.includes('r=') ? new URL(payload, 'https://x.invalid').searchParams.get('r') ?? payload : payload;
  return JSON.parse(fromBase64Url(raw)) as MerchantReceipt;
}
