import { verifyTypedData, type Address } from 'viem';
import { merchantReceiptTypedData, type MerchantReceipt, type PurchaseClaim } from '@receipts/core';
import { RailError, makeClaim } from './claim';

// Rail 5: the merchant signs each receipt (EIP-712) through the dashboard API or prints it as a QR on the bill.
// Tier A: items and amount are signed by the merchant. The weakness is selective issuance (QRs only for happy
// customers); the trust engine tracks each merchant's receipt share and down-weights selective issuers.

export async function verifyMerchantReceipt(input: {
  receipt: MerchantReceipt;
  /** The signer registered on the merchant's dashboard account. */
  signer: Address;
  merchantName: string;
  brandId?: string;
  category?: string;
  cityId?: string;
  wallet: string;
  maxAgeDays?: number;
}): Promise<PurchaseClaim> {
  const r = input.receipt;
  const td = merchantReceiptTypedData(r);
  const ok = await verifyTypedData({ address: input.signer, ...td, signature: r.signature });
  if (!ok) throw new RailError('bad_signature', 'the receipt was not signed by this merchant');
  const issued = new Date(r.issuedAt * 1000);
  if (input.maxAgeDays && Date.now() - issued.getTime() > input.maxAgeDays * 86_400_000) {
    throw new RailError('too_old', 'this receipt is too old to review');
  }
  return makeClaim({
    rail: 'merchant_receipt',
    brandId: input.brandId ?? 'local',
    category: input.category,
    merchant: { name: input.merchantName, cityId: input.cityId },
    items: r.items.map((i) => ({ name: i.name, quantity: i.qty, priceMinor: i.priceMinor })),
    amountMinor: r.amountMinor,
    currency: r.currency === 'INR' ? 'INR' : 'USD',
    purchasedOn: issued.toISOString().slice(0, 10),
    orderRef: r.receiptId,
    nullifierSource: `receipt:${r.merchantId}`,
    boundWallet: input.wallet,
    proof: { kind: 'merchant_receipt', receipt: r, signer: input.signer },
    meta: { merchantId: r.merchantId },
  });
}
