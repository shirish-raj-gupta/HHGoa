'use client';

import { use, useEffect, useState } from 'react';
import type { Insights } from '@receipts/client';
import { MapPin } from 'lucide-react';
import { Button, Card, errorText, ExternalLink, inputCls, Mono, Notice, PageTitle, Stars, Tag, useSession } from '@receipts/react';
import { AspectBars, RatingTrend, WeeklyReviews } from '@/components/charts';
import { ReceiptMaker } from '@/components/receipt-maker';
import { RequireMerchant } from '@/components/require-merchant';
import { ReviewList } from '@/components/review-list';
import { WEB_URL } from '@/lib/env';

export default function Dashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireMerchant>
      <DashboardInner merchantId={id} />
    </RequireMerchant>
  );
}

const TABS = ['Overview', 'Reviews', 'Receipts', 'Badge and plan'] as const;

function DashboardInner({ merchantId }: { merchantId: string }) {
  const { client, config } = useSession();
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');

  useEffect(() => {
    client.merchants
      .insights(merchantId)
      .then(setData)
      .catch((e) => setError(errorText(e)));
  }, [client, merchantId]);

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data)
    return (
      <div className="space-y-4" aria-busy>
        <div className="skeleton h-12 w-1/2" />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="skeleton h-28" />
          <div className="skeleton h-28" />
          <div className="skeleton h-28" />
        </div>
        <div className="skeleton h-64" />
      </div>
    );
  const m = data.merchant;
  const score = m.score === null ? null : Number(m.score);

  return (
    <div className="space-y-5">
      <PageTitle
        eyebrow="Your listing"
        title={m.name}
        sub={
          <span className="flex items-start gap-1.5">
            <MapPin className="mt-1 size-4 shrink-0" aria-hidden />
            <span>
              {m.address ?? config?.cities.find((c) => c.id === m.city_id)?.name ?? 'Online'}
              {m.maps_url ? (
                <>
                  {' · '}
                  <ExternalLink href={m.maps_url}>Google Maps</ExternalLink>
                </>
              ) : null}
            </span>
          </span>
        }
      />
      <div className="-mt-4 flex flex-wrap gap-1.5">
        <Tag tone="good">claimed by {data.account.claimMethod.replace('_', ' ')}</Tag>
        {data.account.easUid ? <Tag tone="accent">on-chain</Tag> : null}
        <Tag>{data.account.plan === 'pro' ? 'Pro' : 'Free plan'}</Tag>
      </div>

      <div role="tablist" aria-label="Listing" className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-11 shrink-0 border-b-2 px-3 text-sm transition-colors ${tab === t ? 'border-accent font-semibold text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4!">
              <div className="text-2xl font-semibold">{score?.toFixed(1) ?? '—'}</div>
              <div className="text-xs text-muted">trust score</div>
              <Stars value={score} size="text-xs" />
            </Card>
            <Card className="p-4!">
              <div className="text-2xl font-semibold">{m.verified_reviews}</div>
              <div className="text-xs text-muted">verified reviews</div>
            </Card>
            <Card className="p-4!">
              <div className="text-2xl font-semibold">{m.durability === null ? '—' : `${Math.round(Number(m.durability) * 100)}%`}</div>
              <div className="text-xs text-muted">still good at check-in</div>
            </Card>
            <Card className="p-4!">
              <div className="text-2xl font-semibold">
                {data.receipts.claimed}/{data.receipts.issued}
              </div>
              <div className="text-xs text-muted">signed receipts claimed</div>
            </Card>
          </div>

          {data.alerts.length ? (
            <Notice tone="warn">
              {data.alerts.length} trust alert{data.alerts.length > 1 ? 's' : ''} touch your listing (for example {data.alerts[0]!.signal.replace(/_/g, ' ')}). Reviews in a confirmed
              ring stop counting; you do not need to do anything.
            </Notice>
          ) : null}

          {data.weekly.length ? (
            <div className="grid gap-5 md:grid-cols-2">
              <Card>
                <WeeklyReviews data={data.weekly} />
              </Card>
              <Card>
                <RatingTrend data={data.weekly} />
              </Card>
            </div>
          ) : null}
          {data.aspects.length ? (
            <Card>
              <AspectBars data={data.aspects} />
            </Card>
          ) : null}

          <div className="grid gap-5 md:grid-cols-2">
            <Card className="space-y-2">
              <div className="text-sm font-semibold">How buyers proved their purchase</div>
              {data.rails.length === 0 ? (
                <p className="text-sm text-muted">No verified reviews yet. Sign a QR for each bill (the Receipts tab) and customers can review in under a minute.</p>
              ) : null}
              {data.rails.map((r) => (
                <div key={r.rail} className="flex justify-between text-sm">
                  <span>{config?.rails[r.rail]?.label ?? r.rail}</span>
                  <span className="tabular-nums text-muted">{r.reviews}</span>
                </div>
              ))}
            </Card>
            <Card className="space-y-2">
              <div className="text-sm font-semibold">Questions where agents and shoppers saw you</div>
              {data.questions.length === 0 ? <p className="text-sm text-muted">None yet.</p> : null}
              {data.questions.slice(0, 8).map((q, i) => (
                <div key={i} className="flex gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">“{q.query}”</span>
                  <Tag>{q.payment_method === 'x402' ? 'AI agent' : q.payment_method === 'credits' ? 'API' : 'web'}</Tag>
                </div>
              ))}
            </Card>
          </div>
        </div>
      ) : null}

      {tab === 'Reviews' ? <ReviewList merchantId={merchantId} reviews={data.reviews} rails={config?.rails} /> : null}

      {tab === 'Receipts' ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">A signed receipt lets a customer review exactly what they bought, with item-level proof, without any delivery app in between.</p>
          <ReceiptMaker merchantId={merchantId} />
        </div>
      ) : null}

      {tab === 'Badge and plan' ? <BadgeAndPlan merchantId={merchantId} /> : null}
    </div>
  );
}

function BadgeAndPlan({ merchantId }: { merchantId: string }) {
  const { client } = useSession();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const embed = `<iframe src="${WEB_URL}/badge/${merchantId}" width="260" height="72" style="border:0" title="Receipts badge"></iframe>`;

  const upgrade = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await client.merchants.checkout(merchantId, email.trim());
      if (r.checkoutUrl) window.location.href = r.checkoutUrl;
      else setError('Checkout is not available right now.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="text-sm font-semibold">Badge for your website</div>
        <iframe src={`${WEB_URL}/badge/${merchantId}`} width={260} height={72} style={{ border: 0 }} title="Receipts badge preview" />
        <Mono className="block rounded-lg bg-sunken p-3">{embed}</Mono>
        <p className="text-xs text-muted">
          It shows your live score and links to <ExternalLink href={`${WEB_URL}/m/${merchantId}`}>your public page</ExternalLink>.
        </p>
      </Card>
      <Card className="space-y-3">
        <div className="text-sm font-semibold">Receipts Pro</div>
        <p className="text-sm text-muted">A monthly plan billed through Dodo Payments. Paying never changes your score, your ranking or any review.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@yourbusiness.in" aria-label="Billing email" />
          <Button busy={busy} disabled={!email.includes('@')} onClick={() => void upgrade()}>
            Upgrade
          </Button>
        </div>
        {error ? <Notice tone="bad">{error}</Notice> : null}
      </Card>
    </div>
  );
}
