'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { decodeReceiptQr } from '@receipts/core';
import { inr } from '@receipts/client';
import { RequireHuman } from '@/components/require-human';
import { Button, Card, errorText, Notice, useSession } from '@receipts/react';

export function ScanClaim({ payload }: { payload: string | null }) {
  const receipt = useMemo(() => {
    if (!payload) return null;
    try {
      return decodeReceiptQr(payload);
    } catch {
      return null;
    }
  }, [payload]);

  if (!payload) return <Notice tone="warn">Scan the Receipts QR printed on your bill to open it here.</Notice>;
  if (!receipt) return <Notice tone="bad">This QR is not a Receipts receipt, or it was cut off. Scan it again.</Notice>;

  return (
    <div className="space-y-4">
      <Card className="space-y-2 font-mono text-sm">
        {receipt.items.map((i) => (
          <div key={i.name} className="flex justify-between gap-3">
            <span>
              {i.qty} × {i.name}
            </span>
            <span>{inr(i.priceMinor * i.qty)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-dashed border-line pt-2 font-semibold">
          <span>Total</span>
          <span>{inr(receipt.amountMinor)}</span>
        </div>
        <div className="text-xs text-muted">Issued {new Date(receipt.issuedAt * 1000).toLocaleString('en-IN')}</div>
      </Card>
      <RequireHuman what="claim this receipt">
        <Claim payload={payload} />
      </RequireHuman>
    </div>
  );
}

function Claim({ payload }: { payload: string }) {
  const { client } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      const purchase = await client.proofs.merchantReceipt(payload);
      const card = await client.reviews.create(purchase.id);
      router.push(`/review/${card.draftId}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button busy={busy} onClick={() => void claim()} className="w-full sm:w-auto">
        Claim and review
      </Button>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </div>
  );
}
