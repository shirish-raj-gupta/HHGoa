'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { RAIL_TIER } from '@receipts/core';
import { inr, type MyReview, type PurchaseView } from '@receipts/client';
import { PinPlace } from '@/components/pin-place';
import { ProvePurchase } from '@/components/prove';
import { RequireHuman } from '@/components/require-human';
import { Button, Card, EmptyState, errorText, Notice, PageTitle, SimulatedTag, Skeleton, Stagger, StaggerItem, Stars, Tag, useSession } from '@receipts/react';
import Link from 'next/link';
import { ChevronRight, ReceiptText, X } from 'lucide-react';

export default function ReviewHome() {
  return (
    <div>
      <PageTitle eyebrow="No receipt, no review" title="Write a verified review" sub="Prove the purchase, then say what you thought in fifteen seconds." />
      <RequireHuman>
        <ReviewInner />
      </RequireHuman>
    </div>
  );
}

function ReviewInner() {
  const { client, config } = useSession();
  const router = useRouter();
  const [purchases, setPurchases] = useState<PurchaseView[] | null>(null);
  const [mine, setMine] = useState<MyReview[]>([]);
  const [proving, setProving] = useState(false);
  const [pinning, setPinning] = useState<PurchaseView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, m] = await Promise.all([client.purchases.list(), client.reviews.mine()]);
    setPurchases(p);
    setMine(m);
  }, [client]);

  useEffect(() => {
    load().catch((e) => setError(errorText(e)));
  }, [load]);

  const startReview = async (p: PurchaseView) => {
    setBusyId(p.id);
    setError(null);
    try {
      const card = await client.reviews.create(p.id);
      router.push(`/review/${card.draftId}`);
    } catch (e) {
      setError(errorText(e));
      setBusyId(null);
    }
  };

  const toReview = purchases?.filter((p) => !p.reviewed) ?? [];
  // A UPI payment names the payee, not the shop: ask which shop it was (Google Maps) before the review.
  const needsPlace = (p: PurchaseView) => !!config?.places.google && p.rail === 'payment_proof' && !p.place.fromGoogle && p.reviewable.ok;

  return (
    <div className="space-y-6">
      {error ? <Notice tone="bad">{error}</Notice> : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Purchases ready to review</h2>
          <Button tone={proving ? 'secondary' : 'brand'} onClick={() => setProving((v) => !v)}>
            {proving ? <X className="size-4" aria-hidden /> : <ReceiptText className="size-4" aria-hidden />}
            {proving ? 'Close' : 'Prove a purchase'}
          </Button>
        </div>
        {proving ? (
          <ProvePurchase
            onPurchase={(p) => {
              setProving(false);
              void load();
              if (needsPlace(p)) setPinning(p);
              else if (p.reviewable.ok) void startReview(p);
              else setError(p.reviewable.reason ?? 'This purchase cannot be reviewed yet.');
            }}
          />
        ) : null}
        {pinning ? (
          <PinPlace
            purchase={pinning}
            onDone={(p) => {
              setPinning(null);
              void load();
              if (p.reviewable.ok) void startReview(p);
            }}
          />
        ) : null}
        {purchases === null ? (
          <div className="space-y-3" aria-busy>
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : null}
        {purchases && toReview.length === 0 && !proving ? (
          <EmptyState icon={<ReceiptText />} title="Nothing waiting" action={<Button tone="brand" onClick={() => setProving(true)}>Prove a purchase</Button>}>
            No proven purchases are waiting for a review. Prove one to start: an order page, an order email, a QR on your bill, or a payment.
          </EmptyState>
        ) : null}
        <Stagger className="space-y-3">
        {toReview.map((p) => (
          <StaggerItem key={p.id}>
          <Card className="flex flex-wrap items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-sunken font-display text-lg font-bold" aria-hidden>
              {p.merchant.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-display text-lg font-bold">{p.merchant}</div>
              <div className="text-sm text-muted">
                {p.items.map((i) => i.name).join(', ')} · {inr(p.amountMinor)} · {p.purchasedOn}
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Tag tone={RAIL_TIER[p.rail] === 'A' ? 'good' : 'neutral'}>{config?.rails[p.rail]?.label ?? p.rail}</Tag>
                <SimulatedTag show={p.simulated} />
                {!p.reviewable.ok ? <Tag tone="warn">{p.reviewable.reason}</Tag> : null}
              </div>
            </div>
            {needsPlace(p) ? (
              <Button tone="secondary" onClick={() => setPinning(p)}>
                Pin the shop
              </Button>
            ) : null}
            <Button busy={busyId === p.id} disabled={!p.reviewable.ok} onClick={() => void startReview(p)}>
              Review
            </Button>
          </Card>
          </StaggerItem>
        ))}
        </Stagger>
      </section>

      {mine.length ? (
        <section className="space-y-2">
          <h2 className="text-xl font-bold">Your reviews</h2>
          {mine.map((r) => (
            <Link key={r.id} href={`/r/${r.eas_uid ?? r.id}`} className="group flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm transition-colors hover:border-accent">
              <Stars value={r.rating} size="text-sm" />
              <span className="min-w-0 flex-1 truncate">
                {r.item} · <span className="text-muted">{r.merchant}</span>
              </span>
              {r.status !== 'active' ? <Tag tone="warn">{r.status}</Tag> : null}
              {r.eas_uid ? <Tag tone="good">on-chain</Tag> : null}
              <ChevronRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  );
}
