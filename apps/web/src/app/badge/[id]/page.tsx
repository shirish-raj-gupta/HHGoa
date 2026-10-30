import { WEB_URL } from '@/lib/env';
import { orNull, serverClient } from '@/lib/server-api';

// The embeddable badge (an iframe on the merchant's own site). Live scores; no site chrome.

export const metadata = { robots: { index: false } };

export default async function Badge({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await orNull(serverClient.badge(id));
  if (!b) return null;
  return (
    <a href={`${WEB_URL}/m/${b.merchantId}`} target="_blank" rel="noreferrer" className="m-1 flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 no-underline">
      <span className="grid size-9 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-ink">{b.score?.toFixed(1) ?? 'R'}</span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-ink">{b.label}</span>
        <span className="block text-xs text-muted">
          {b.verifiedReviews} verified buyers{b.claimed ? ' · claimed' : ''}
        </span>
      </span>
    </a>
  );
}
