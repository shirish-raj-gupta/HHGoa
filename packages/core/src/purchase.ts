import { encodeAbiParameters, keccak256, type Hex } from 'viem';
import { z } from 'zod';
import { RAILS } from './rails';
import { canonicalJson } from './cid';

export const HexString = z.string().regex(/^0x[0-9a-fA-F]*$/, 'hex string') as unknown as z.ZodType<Hex>;
export const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'bytes32 hex') as unknown as z.ZodType<Hex>;
export const AddressString = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'address') as unknown as z.ZodType<`0x${string}`>;
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const PurchaseItem = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().int().positive().default(1),
  priceMinor: z.number().int().nonnegative().optional(),
  variant: z.string().max(120).optional(),
});
export type PurchaseItem = z.infer<typeof PurchaseItem>;

export const MerchantRef = z.object({
  name: z.string().min(1).max(200),
  /** The brand's own ID for the outlet, e.g. a Swiggy restaurant ID. */
  externalId: z.string().max(120).optional(),
  /** Payee VPA for UPI payment proofs. */
  upiVpa: z.string().max(120).optional(),
  address: z.string().max(400).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  cityId: z.string().optional(),
  /** On-chain payee for rail 6. */
  wallet: AddressString.optional(),
});
export type MerchantRef = z.infer<typeof MerchantRef>;

export const PurchaseStatus = z.enum(['confirmed', 'pending', 'cancelled']);

/** The one object every rail produces. Everything downstream trusts only this. */
export const PurchaseClaim = z.object({
  rail: z.enum(RAILS),
  tier: z.enum(['A', 'B']),
  brandId: z.string().min(1),
  category: z.string().optional(),
  merchant: MerchantRef,
  items: z.array(PurchaseItem).max(60),
  amountMinor: z.number().int().nonnegative(),
  currency: z.enum(['INR', 'USD', 'USDC']),
  purchasedOn: IsoDate,
  /** Order ID, booking ID, UPI reference or tx hash. Secret: only its hash (the nullifier) is ever published. */
  orderRef: z.string().min(1).max(200),
  nullifier: Bytes32,
  /** The wallet signed into the proof. Must equal the session wallet. */
  boundWallet: AddressString,
  proofHash: Bytes32,
  status: PurchaseStatus,
  /** True only for labelled demo history and the dev rail. Never counted in production. */
  simulated: z.boolean().default(false),
  /** Rail-specific extras: trip end date, return window, move-in date, network, provider ID... */
  meta: z.record(z.string(), z.unknown()).default({}),
  /** The raw proof, kept server-side only: encrypted at rest for auditors, never published. proofHash commits to it. */
  proof: z.unknown().optional(),
});
export type PurchaseClaim = z.infer<typeof PurchaseClaim>;

/**
 * One purchase, one review, across rails: the nullifier is a hash of the source (the brand, or "upi" for UPI
 * references) and the order reference. The same Swiggy order proven by its page and by its email collides.
 */
export function purchaseNullifier(source: string, orderRef: string): Hex {
  return keccak256(
    encodeAbiParameters([{ type: 'string' }, { type: 'string' }], [source.trim().toLowerCase(), orderRef.trim()]),
  );
}

export function upiNullifier(upiRef: string): Hex {
  return purchaseNullifier('upi', upiRef.replace(/\s+/g, ''));
}

/** keccak256 of the canonical JSON of a proof object; goes on-chain as proofHash. */
export function proofHashOf(proof: unknown): Hex {
  return keccak256(new TextEncoder().encode(canonicalJson(proof)));
}
