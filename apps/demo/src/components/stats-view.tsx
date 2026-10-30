'use client';

import { useCallback, useEffect, useState } from 'react';
import { ReceiptsClient, type Stats } from '@receipts/client';
import { Card, RollingNumber, type CardTone } from '@receipts/react';
import { API_URL } from '@/lib/env';

// The week in numbers, live. Real activity only; simulated demo data is counted on its own line.

const client = new ReceiptsClient({ baseUrl: API_URL });
const BLOCKS: CardTone[] = ['lime', 'sky', 'pink', 'sun', 'violet', 'tangerine'];

export function StatsView() {
  const [s, setS] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    client
      .stats()
      .then((x) => {
        setS(x);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
    const source = new EventSource(client.eventsStreamUrl());
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        load();
      }, 800);
    };
    for (const t of ['review.published', 'payment.settled', 'answer.served', 'human.verified', 'payout.claimed', 'payout.inr', 'merchant.claimed', 'followup.answered', 'flag.opened']) {
      source.addEventListener(t, bump);
    }
    return () => {
      source.close();
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  if (error) return <p className="text-bad">{error}</p>;
  if (!s)
    return (
      <div className="space-y-4" aria-busy>
        <div className="skeleton h-28 w-1/2" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton h-24" />
          ))}
        </div>
      </div>
    );

  const tiles: [string, string][] = [
    ['Unique humans', s.humans.toLocaleString('en-IN')],
    ['Brands', String(s.brands)],
    ['Categories', String(s.categories)],
    ['Cities', String(s.cities)],
    ['Proof rails used', String(s.rails)],
    ['Paid agent queries', s.paidQueries.toLocaleString('en-IN')],
    ['Paid by agents', `$${Number(s.paidUsdc).toFixed(2)}`],
    ['Earned by reviewers', `$${Number(s.earnedByReviewersUsdc).toFixed(2)}`],
    ['Paid out in rupees', `₹${s.paidOutInr.toLocaleString('en-IN')}`],
    ['USDC claims', String(s.claims)],
    ['Check-ins answered', String(s.followupsAnswered)],
    ['Businesses claimed', String(s.merchantsClaimed)],
  ];

  return (
    <div className="space-y-6">
      <div>
        <div className="font-display text-8xl font-extrabold tracking-tight text-good">
          <RollingNumber value={s.receipts} />
        </div>
        <div className="text-lg text-muted">verified reviews from real purchases</div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map(([label, value], i) => (
          <Card key={label} tone={BLOCKS[i % BLOCKS.length]} className="p-5!">
            <div className="font-display text-3xl font-bold tabular-nums">{value}</div>
            <div className="mt-1 text-sm text-block-ink/85">{label}</div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted">
        {s.flags} trust flags raised. Plus {s.simulatedReceipts.toLocaleString('en-IN')} simulated demo reviews, not counted above.
      </p>
    </div>
  );
}
