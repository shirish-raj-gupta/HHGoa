'use client';

import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/env';

// The live feed under the stage: payments settling, reviews landing, flags raised. Straight from the API's SSE stream.

interface StageEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
  created_at: string;
}

const TYPES = [
  'answer.served',
  'payment.settled',
  'review.published',
  'purchase.proven',
  'human.verified',
  'followup.answered',
  'merchant.claimed',
  'merchant.replied',
  'flag.opened',
  'flag.investigated',
  'attack.planted',
  'epoch.posted',
  'payout.claimed',
  'payout.inr',
  'shop.conversion',
  'shop.cashback',
];

function describe(ev: StageEvent): string | null {
  const d = ev.data;
  const sim = d.simulated ? ' (simulated)' : '';
  const q = String(d.query ?? '').slice(0, 48);
  switch (ev.type) {
    case 'answer.served':
      return d.method === 'x402' || d.method === 'credits' ? `An agent paid $${String(d.price_usdc)} for “${q}”` : `Someone asked “${q}”`;
    case 'payment.settled':
      return `USDC payment settled on Base${d.tx ? ` · ${String(d.tx).slice(0, 10)}…` : ''}`;
    case 'review.published':
      return `New verified review: ${String(d.rating ?? '')}★ ${String(d.item ?? '')}${sim}`;
    case 'purchase.proven':
      return `Purchase proven at ${String(d.merchant ?? '')}${sim}`;
    case 'human.verified':
      return 'A new unique human joined';
    case 'followup.answered':
      return 'A reviewer answered a check-in';
    case 'merchant.claimed':
      return 'A business claimed its listing';
    case 'merchant.replied':
      return 'A business replied in public';
    case 'flag.opened':
      return `Trust flag: ${String(d.signal ?? '').replace(/_/g, ' ')}`;
    case 'flag.investigated':
      return `Investigator filed a case: ${String(d.recommendation ?? '')}`;
    case 'attack.planted':
      return `Simulated attack: ${String(d.accounts)} planted accounts`;
    case 'epoch.posted':
      return 'Payout epoch posted on Base';
    case 'payout.claimed':
      return 'A reviewer claimed USDC';
    case 'payout.inr':
      return `₹${String(d.rupees)} paid to a reviewer’s UPI${d.testMode ? ' (test mode)' : ''}`;
    case 'shop.conversion':
      return `Shop-through purchase ${String(d.status ?? '')}${d.test ? ' (test network)' : ''}`;
    case 'shop.cashback':
      return `₹${String(d.rupees)} cashback to a buyer${d.testMode ? ' (test mode)' : ''}`;
    default:
      return null;
  }
}

export function Ticker() {
  const [events, setEvents] = useState<StageEvent[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const source = new EventSource(`${API_URL}/v1/events/stream`);
    const onEvent = (e: MessageEvent<string>) => {
      try {
        const ev = JSON.parse(e.data) as StageEvent;
        if (!describe(ev)) return;
        setEvents((prev) => (prev.some((p) => p.id === ev.id) ? prev : [ev, ...prev].slice(0, 12)));
      } catch {
        // pings and malformed lines are skipped
      }
    };
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    for (const t of TYPES) source.addEventListener(t, onEvent as EventListener);
    return () => source.close();
  }, []);

  return (
    <div className="flex items-center gap-3 overflow-hidden rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
      <span className={`inline-flex shrink-0 items-center gap-2 font-semibold ${live ? 'text-good' : 'text-muted'}`}>
        <span className="relative flex size-2.5" aria-hidden>
          {live ? <span className="absolute inset-0 animate-ping rounded-full bg-good/60" /> : null}
          <span className={`relative size-2.5 rounded-full ${live ? 'bg-good' : 'bg-line'}`} />
        </span>
        {live ? 'Live' : 'Offline'}
      </span>
      <div className="flex min-w-0 gap-4 overflow-x-auto whitespace-nowrap text-muted">
        {events.length === 0 ? <span>Waiting for activity…</span> : null}
        {events.map((ev) => (
          <span key={ev.id}>
            <span className="text-ink">{describe(ev)}</span> · {new Date(ev.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        ))}
      </div>
    </div>
  );
}
