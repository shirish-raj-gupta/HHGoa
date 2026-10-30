import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, Mono, PageTitle, SimulatedTag, Stars, Tag } from '@receipts/react';
import { WEB_URL } from '@/lib/env';
import { orNull, serverClient } from '@/lib/server-api';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const m = await orNull(serverClient.merchant(id));
  return { title: m ? `${m.merchant}: verified reviews` : 'Not found' };
}

export default async function MerchantPage({ params }: Props) {
  const { id } = await params;
  const m = await orNull(serverClient.merchant(id));
  if (!m) notFound();
  const embed = `<iframe src="${WEB_URL}/badge/${m.merchant_id}" width="260" height="72" style="border:0" title="Receipts badge"></iframe>`;

  return (
    <div className="space-y-5">
      <PageTitle eyebrow="Business" title={m.merchant} sub={[m.category, m.city].filter(Boolean).join(' · ')} />
      <div className="-mt-4 flex flex-wrap gap-1.5">
        {m.claimed ? <Tag tone="good">claimed by the business</Tag> : <Tag>not claimed yet</Tag>}
        <SimulatedTag show={m.simulated} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4!">
          <div className="text-xl font-bold">{m.score?.toFixed(1) ?? '—'}</div>
          <Stars value={m.score} size="text-xs" />
        </Card>
        <Card className="p-4!">
          <div className="text-xl font-bold">{m.verified_reviews}</div>
          <div className="text-xs text-muted">verified buyers</div>
        </Card>
        <Card className="p-4!">
          <div className="text-xl font-bold">{m.reply_rate === null ? '—' : `${Math.round(m.reply_rate * 100)}%`}</div>
          <div className="text-xs text-muted">replied in public</div>
        </Card>
      </div>
      <Card className="p-0!">
        {m.items.map((i) => (
          <div key={i.item_id} className="flex items-center gap-3 border-b border-line px-4 py-3 text-sm last:border-0">
            <span className="flex-1">{i.item}</span>
            <span className="text-muted">{i.verified_reviews} reviews</span>
            <span className="w-10 text-right font-semibold">{i.score?.toFixed(1) ?? '—'}</span>
          </div>
        ))}
      </Card>
      <Card className="space-y-2">
        <h2 className="text-sm font-semibold">Show this on your site</h2>
        <Mono className="block rounded-lg bg-sunken p-3">{embed}</Mono>
        <p className="text-xs text-muted">The badge reads live scores. Businesses can reply in public, but cannot hide, edit or re-rank reviews.</p>
      </Card>
      <p className="text-xs text-muted">{m.disclosure}</p>
    </div>
  );
}
