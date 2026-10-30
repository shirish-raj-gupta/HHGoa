import { encodeAbiParameters, keccak256, toBytes, type Hex } from 'viem';
import { normalizeName } from './text';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** Short random IDs with a readable prefix, e.g. "rv_k3m9x2pq7d4h". */
export function newId(prefix: string, length = 14): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

export function randomHex32(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}

/** Merchants are keyed by brand + city + the brand's own ID for the outlet (or its normalised name). */
export function merchantIdFor(input: { brandId: string; cityId?: string | null; externalId?: string | null; name: string }): Hex {
  const key = input.externalId?.trim() || normalizeName(input.name);
  return keccak256(toBytes(`merchant|${input.brandId}|${input.cityId ?? 'any'}|${key}`));
}

/** An item is a dish, product variant, room type, service or building at one merchant. This is the on-chain itemId. */
export function itemIdFor(merchantId: Hex, canonicalName: string, variant?: string | null): Hex {
  return keccak256(toBytes(`item|${merchantId}|${normalizeName(canonicalName)}|${normalizeName(variant ?? '')}`));
}

export const REVIEWER_DOMAIN = keccak256(toBytes('receipts.reviewer.v1'));

/**
 * The reviewer's public ID, derived from the app-scoped personhood nullifier. PersonhoodRegistry derives it the
 * same way, so it survives wallet changes and never exposes the raw nullifier.
 */
export function reviewerIdFromNullifier(nullifierHash: Hex): Hex {
  return keccak256(
    encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [REVIEWER_DOMAIN, nullifierHash]),
  );
}

/** Hash an arbitrary personhood nullifier (decimal field element or hex) into bytes32. */
export function nullifierToBytes32(nullifier: string | bigint): Hex {
  if (typeof nullifier === 'bigint') return `0x${nullifier.toString(16).padStart(64, '0')}` as Hex;
  if (/^0x[0-9a-fA-F]{64}$/.test(nullifier)) return nullifier.toLowerCase() as Hex;
  if (/^\d+$/.test(nullifier)) return `0x${BigInt(nullifier).toString(16).padStart(64, '0')}` as Hex;
  return keccak256(toBytes(nullifier));
}
