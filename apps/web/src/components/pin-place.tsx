'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowUpRight, MapPin, Search } from 'lucide-react';
import { inr, type GooglePlace, type PurchaseView } from '@receipts/client';
import { Button, Card, errorText, inputCls, Notice, Skeleton, Tag, useSession } from '@receipts/react';

// A UPI payment proves who was paid (often a legal name, like "SHREE GANESH ENTERPRISES"), not which shop that is.
// The reviewer picks the shop on Google Maps, so the review lands on the right place; the first pin places that
// payee for everyone after. Skipping keeps the review on the payee's name.

export function PinPlace({ purchase, onDone }: { purchase: PurchaseView; onDone(p: PurchaseView): void }) {
  const { client } = useSession();
  const payee = purchase.payeeName ?? purchase.merchant;
  const [q, setQ] = useState('');
  const [places, setPlaces] = useState<GooglePlace[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(
    async (query?: string) => {
      setPlaces(null);
      setError(null);
      try {
        setPlaces(await client.purchases.places(purchase.id, query));
      } catch (e) {
        setError(errorText(e));
        setPlaces([]);
      }
    },
    [client, purchase.id],
  );

  useEffect(() => {
    void search();
  }, [search]);

  const pin = async (placeId: string) => {
    setBusy(placeId);
    setError(null);
    try {
      onDone(await client.purchases.pinPlace(purchase.id, placeId));
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) void search(q.trim());
  };

  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-ink">
          <MapPin className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <h3 className="font-display text-lg font-bold">Which shop was this?</h3>
          <p className="text-sm text-muted">
            Your payment proves you paid <span className="font-semibold text-ink">{payee}</span> {inr(purchase.amountMinor)} on {purchase.purchasedOn}. Pick the shop
            on Google Maps so your review lands on the right place.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="flex gap-2" role="search">
        <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search Google Maps, e.g. "${payee}"`} aria-label="Search for the shop" />
        <Button type="submit" tone="secondary" disabled={!q.trim()} className="shrink-0">
          <Search className="size-4" aria-hidden />
          Search
        </Button>
      </form>

      {error ? <Notice tone="bad">{error}</Notice> : null}

      {places === null ? (
        <div className="space-y-2" aria-busy>
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : places.length === 0 && !error ? (
        <p className="text-sm text-muted">Nothing on Google Maps by that name here. Try the name on the shop&apos;s signboard.</p>
      ) : (
        <ul className="space-y-2">
          {places.map((p) => (
            <li key={p.placeId} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-2.5 sm:flex-nowrap">
              {/* eslint-disable-next-line @next/next/no-img-element -- a map image from our API's Google proxy */}
              <img src={client.staticMapUrl(p.lat, p.lng)} alt="" width={128} height={72} className="h-18 w-32 shrink-0 rounded-xl bg-sunken object-cover" loading="lazy" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-muted">
                  {p.kind ? `${p.kind} · ` : ''}
                  {p.address}
                </div>
                {p.mapsUrl ? (
                  <a href={p.mapsUrl} target="_blank" rel="noreferrer" className="link mt-1 inline-flex items-center gap-0.5 text-xs font-medium">
                    View on Google Maps
                    <ArrowUpRight className="size-3" aria-hidden />
                  </a>
                ) : null}
              </div>
              <Button busy={busy === p.placeId} disabled={!!busy} onClick={() => void pin(p.placeId)} className="w-full sm:w-auto">
                This one
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <Tag>Places from Google Maps</Tag>
        <Button tone="ghost" disabled={!!busy} onClick={() => onDone(purchase)}>
          Skip: keep it as &quot;{payee}&quot;
        </Button>
      </div>
    </Card>
  );
}
