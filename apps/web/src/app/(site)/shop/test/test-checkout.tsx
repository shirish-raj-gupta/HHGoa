'use client';

import { useState } from 'react';
import { Button, errorText, Field, inputCls, Notice, useSession } from '@receipts/react';

/** Fires the test network's conversion for this click (an operator action; open on a local API). */
export function TestCheckout({ clickId }: { clickId: string }) {
  const { client } = useSession();
  const [amount, setAmount] = useState('499');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  const buy = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await client.admin.testConversion(clickId, Number(amount), 'confirmed');
      setMsg({ tone: 'good', text: 'Test purchase recorded. If you were signed in when you clicked, it is waiting under “Purchases ready to review”.' });
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <Field label="Order total (₹)">
          <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Button busy={busy} onClick={() => void buy()}>
          Place test order
        </Button>
      </div>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </div>
  );
}
