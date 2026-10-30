'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronRight, Store } from 'lucide-react';
import type { MerchantAccount } from '@receipts/client';
import { EmptyState, errorText, LinkButton, Notice, PageTitle, Skeleton, SpotlightCard, Stagger, StaggerItem, Stars, Tag, useSession } from '@receipts/react';
import { RequireMerchant } from '@/components/require-merchant';

export default function Home() {
  return (
    <div>
      <PageTitle
        eyebrow="Receipts for business"
        title="See what verified buyers say about you"
        sub="Every review comes with a proof of purchase. Claim your listing to reply in public, learn what to fix, and give customers signed receipts they can review."
      />
      <RequireMerchant>
        <Listings />
      </RequireMerchant>
    </div>
  );
}

function Listings() {
  const { client } = useSession();
  const [mine, setMine] = useState<MerchantAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client.merchants
      .mine()
      .then(setMine)
      .catch((e) => setError(errorText(e)));
  }, [client]);

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!mine)
    return (
      <div className="grid gap-3 sm:grid-cols-2" aria-busy>
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
    );
  if (mine.length === 0) {
    return (
      <EmptyState icon={<Store />} title="No claimed listings on this wallet yet" action={<LinkButton href="/claim">Claim a listing</LinkButton>}>
        Find your business and verify ownership with a DNS record, your GSTIN, or a business UPI check with manual review when needed.
      </EmptyState>
    );
  }
  return (
    <Stagger className="grid gap-4 sm:grid-cols-2">
      {mine.map((a) => (
        <StaggerItem key={a.id}>
        <SpotlightCard className="h-full rounded-3xl">
        <Link href={`/m/${a.merchant_id}`} className="group block h-full rounded-3xl border border-line bg-surface p-5 shadow-card transition-[border-color,box-shadow] hover:border-accent hover:shadow-lift">
          <div className="flex items-start justify-between gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-sunken font-display text-lg font-bold" aria-hidden>
              {a.name.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-display text-lg font-bold">{a.name}</div>
              <div className="text-sm text-muted">
                {a.verified_reviews} verified reviews{a.city_id ? ` · ${a.city_id}` : ''}
              </div>
            </div>
            <div className="text-right">
              <div className="font-display text-2xl font-bold tabular-nums">{a.score === null ? '—' : Number(a.score).toFixed(1)}</div>
              <Stars value={a.score === null ? null : Number(a.score)} size="text-xs" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <Tag tone="good">verified by {a.claim_method.replace('_', ' ')}</Tag>
            {a.eas_uid ? <Tag tone="accent">on-chain</Tag> : null}
            {a.plan === 'pro' ? <Tag tone="brand">Pro</Tag> : null}
            <ChevronRight className="ml-auto size-4 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
          </div>
        </Link>
        </SpotlightCard>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
