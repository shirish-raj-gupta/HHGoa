'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { toHex, type Hex } from 'viem';
import { merchantReceiptTypedData } from '@receipts/core';
import { inr } from '@receipts/client';
import { Button, Card, errorText, inputCls, Notice, QR_PROPS, ScanFrame, useSession } from '@receipts/react';

// Rail 5: the bill as a signed receipt. The business wallet signs an EIP-712 receipt in the browser; the QR carries
// it to the customer's phone, and each receipt can be claimed by one wallet, once.

interface Line {
  name: string;
  qty: string;
  price: string;
}

export function ReceiptMaker({ merchantId }: { merchantId: string }) {
  const { client, wallet } = useSession();
  const [lines, setLines] = useState<Line[]>([{ name: '', qty: '1', price: '' }]);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = lines
    .filter((l) => l.name.trim() && Number(l.price) > 0)
    .map((l) => ({ name: l.name.trim(), qty: Math.max(1, Math.round(Number(l.qty) || 1)), priceMinor: Math.round(Number(l.price) * 100) }));
  const total = items.reduce((s, i) => s + i.qty * i.priceMinor, 0);
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const sign = async () => {
    if (!wallet || items.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const receipt = {
        merchantId: merchantId as Hex,
        receiptId: toHex(crypto.getRandomValues(new Uint8Array(32))),
        amountMinor: total,
        currency: 'INR',
        items,
        issuedAt: Math.floor(Date.now() / 1000),
      };
      const signature = await wallet.signer.signTypedData(merchantReceiptTypedData(receipt) as never);
      const res = await client.merchants.recordReceipt(merchantId, { ...receipt, signature });
      setQr(res.qr);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (qr) {
    return (
      <Card className="flex flex-col items-center gap-3 text-center">
        <ScanFrame label="QR code of this signed receipt, for the customer to scan">
          <QRCodeSVG value={qr} size={232} {...QR_PROPS} />
        </ScanFrame>
        <p className="text-sm">Show this at the counter or print it on the bill. {inr(total)} · {items.length} item{items.length > 1 ? 's' : ''}</p>
        <a href={qr} target="_blank" rel="noreferrer" className="link max-w-full truncate text-xs">
          {qr}
        </a>
        <Button
          tone="secondary"
          onClick={() => {
            setQr(null);
            setLines([{ name: '', qty: '1', price: '' }]);
          }}
        >
          New receipt
        </Button>
      </Card>
    );
  }

  return (
    <Card className="space-y-3">
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_4rem_6rem_auto] gap-2">
          <input className={inputCls} value={l.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Item" aria-label="Item" />
          <input className={inputCls} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} inputMode="numeric" aria-label="Quantity" />
          <input className={inputCls} value={l.price} onChange={(e) => set(i, { price: e.target.value })} inputMode="decimal" placeholder="₹" aria-label="Price" />
          <button onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1} className="px-2 text-sm text-muted disabled:opacity-30" aria-label="Remove line">
            ✕
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button tone="ghost" onClick={() => setLines([...lines, { name: '', qty: '1', price: '' }])}>
          + Add item
        </Button>
        <span className="ml-auto text-sm font-semibold">Total {inr(total)}</span>
        <Button busy={busy} disabled={items.length === 0} onClick={() => void sign()}>
          Sign receipt
        </Button>
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Card>
  );
}
