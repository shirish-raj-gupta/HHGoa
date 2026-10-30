'use client';

import { useState } from 'react';
import { Button, Notice, Tag } from '@receipts/react';
import { operator, setToken, StageAuthError } from '@/lib/stage-client';

// The stage's Settle now: what reviewers have earned from cited answers goes into a USDC root on Base at once, instead
// of at the nightly epoch, so the room can watch a claim land. The API allows it only in DEMO_MODE and labels it.

interface Settled {
  label: string;
  posted: boolean;
  reviewers: number;
  newUsdc: string;
  txHash: string | null;
  reason?: string;
}

export function SettleNow() {
  const [result, setResult] = useState<Settled | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needToken, setNeedToken] = useState(false);
  const [token, setTokenInput] = useState('');

  const settle = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await operator<Settled>('/api/settle'));
    } catch (e) {
      if (e instanceof StageAuthError) setNeedToken(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button busy={busy} onClick={() => void settle()}>
          Settle now
        </Button>
        <Tag tone="warn">demo settlement · normally nightly</Tag>
      </div>
      {needToken ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setToken(token.trim());
            setNeedToken(false);
          }}
        >
          <input className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5" value={token} onChange={(e) => setTokenInput(e.target.value)} placeholder="Operator token (DEMO_TOKEN)" type="password" />
          <Button type="submit" tone="secondary">
            Save
          </Button>
        </form>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {result ? (
        <Notice tone={result.posted ? 'good' : 'neutral'}>
          {result.posted
            ? `${result.label}: ${Number(result.newUsdc).toFixed(4)} USDC for ${result.reviewers} reviewer${result.reviewers === 1 ? '' : 's'}, root posted on Base${result.txHash ? ` (${result.txHash.slice(0, 10)}…)` : ''}. Reviewers can claim it now.`
            : `${result.label}: ${result.reason ?? 'nothing new to settle'}.`}
        </Notice>
      ) : null}
    </div>
  );
}
