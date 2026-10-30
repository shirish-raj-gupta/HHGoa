import { PageTitle } from '@receipts/react';
import { orNull, serverClient } from '@/lib/server-api';
import { ScanClaim } from './scan-claim';

// Landing page of a merchant's signed QR receipt (rail 5). The QR carries the merchant's EIP-712 signature over the
// bill; claiming it binds the purchase to this wallet, once.

export const metadata = { title: 'Claim your receipt' };

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ r?: string; c?: string }> }) {
  // New QRs carry a short code (?c=); older ones the whole signed receipt (?r=).
  const { r, c } = await searchParams;
  const payload = c ? ((await orNull(serverClient.receiptCode(c)))?.payload ?? null) : (r ?? null);
  return (
    <div>
      <PageTitle eyebrow="Signed by the business" title="Your receipt" sub="This bill was signed by the business. Claim it to review what you bought." />
      <ScanClaim payload={payload} />
    </div>
  );
}
