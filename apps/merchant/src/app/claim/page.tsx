'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, MapPin, Search, Store } from 'lucide-react';
import type { GoogleListing, Listing, MerchantClaimMethod } from '@receipts/client';
import { Button, Card, errorText, Eyebrow, Field, inputCls, Notice, PageTitle, SimulatedTag, Skeleton, Tag, useSession } from '@receipts/react';
import { RequireMerchant } from '@/components/require-merchant';

const METHODS: { id: MerchantClaimMethod; label: string; detail: string }[] = [
  { id: 'upi', label: 'Business UPI', detail: 'A ₹1 payment check when available, otherwise a manual ownership review. Follow the instructions after starting your claim.' },
  { id: 'domain', label: 'DNS record', detail: 'Add a TXT record on your website’s domain.' },
  { id: 'gst', label: 'GSTIN', detail: 'We match the GST registration’s legal or trade name to the listing.' },
  { id: 'partner_portal', label: 'Swiggy or Zomato partner dashboard', detail: 'Reviewed by a person for now.' },
];

export default function ClaimPage() {
  return (
    <div>
      <PageTitle eyebrow="Prove it is yours" title="Claim your listing" sub="Claiming lets you reply in public and issue signed receipts. It never lets anyone hide, edit or re-rank a review." />
      <RequireMerchant>
        <Claim />
      </RequireMerchant>
    </div>
  );
}

function Claim() {
  const { client, config } = useSession();
  const router = useRouter();
  const google = !!config?.places.google;
  const [q, setQ] = useState('');
  // Any city in India: suggestions come from the API (configured cities, then Google); a typed name works too.
  const [cityText, setCityText] = useState('');
  const [cities, setCities] = useState<{ id: string | null; name: string; state: string | null }[]>([]);
  const [results, setResults] = useState<Listing[] | null>(null);
  const [onGoogle, setOnGoogle] = useState<GoogleListing[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [picked, setPicked] = useState<Listing | null>(null);
  const [method, setMethod] = useState<MerchantClaimMethod>('upi');
  const [domain, setDomain] = useState('');
  const [gstin, setGstin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const how = useRef<HTMLDivElement>(null);
  const cityLabel = (c: { name: string; state: string | null }) => (c.state ? `${c.name}, ${c.state}` : c.name);

  useEffect(() => {
    const t = setTimeout(() => {
      client.cities(cityText).then(setCities).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [client, cityText]);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPicked(null);
    setSearching(true);
    try {
      const typed = cityText.trim().toLowerCase();
      const match = cities.find((c) => cityLabel(c).toLowerCase() === typed || c.name.toLowerCase() === typed);
      const where = match?.id ? { city: match.id } : { near: cityText.trim() || undefined };
      const [ours, theirs] = await Promise.all([
        client.merchants.search(q.trim(), where),
        google ? client.merchants.searchGoogle(q.trim(), where).catch((err) => (setError(errorText(err)), [])) : Promise.resolve([]),
      ]);
      setResults(ours);
      // Places already on Receipts show once, in our own list.
      setOnGoogle(theirs.filter((g) => !g.listingId || !ours.some((l) => l.id === g.listingId)));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSearching(false);
    }
  };

  const pick = (listing: Listing) => {
    setPicked(listing);
    requestAnimationFrame(() => how.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const addFromGoogle = async (g: GoogleListing) => {
    setAdding(g.place.placeId);
    setError(null);
    try {
      pick(await client.merchants.fromGoogle(g.place.placeId));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setAdding(null);
    }
  };

  const start = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const c = await client.merchants.claim(picked.id, method, { domain: domain.trim() || undefined, gstin: gstin.trim() || undefined });
      sessionStorage.setItem(`claim.${c.claimId}`, JSON.stringify({ ...c, merchant: picked.name, merchantId: picked.id }));
      router.push(`/claim/${c.claimId}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row" role="search">
        <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Your business name" aria-label="Business name" />
        <input
          className={`${inputCls} sm:w-60`}
          list="claim-cities"
          value={cityText}
          onChange={(e) => setCityText(e.target.value)}
          placeholder="City: any in India"
          aria-label="City"
          autoComplete="off"
        />
        <datalist id="claim-cities">
          {cities.map((c) => (
            <option key={cityLabel(c)} value={cityLabel(c)} />
          ))}
        </datalist>
        <Button type="submit" busy={searching} disabled={q.trim().length < 2}>
          <Search className="size-4" aria-hidden />
          Search
        </Button>
      </form>

      {searching && !results ? (
        <div className="space-y-2" aria-busy>
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : null}

      {results ? (
        <section className="space-y-2" aria-label="On Receipts">
          <Eyebrow>On Receipts</Eyebrow>
          {results.length === 0 ? (
            <Card className="text-sm text-muted">{google ? 'Not on Receipts yet. Find it on Google Maps below and add it.' : 'No listing by that name yet.'}</Card>
          ) : null}
          {results.map((r) => (
            <button
              key={r.id}
              disabled={r.claimed}
              onClick={() => pick(r)}
              className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-colors disabled:opacity-50 ${picked?.id === r.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong'}`}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sunken" aria-hidden>
                <Store className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{r.name}</span>
                <span className="text-muted">
                  {r.city_id ?? 'online'} · {r.verified_reviews} verified reviews
                </span>
              </span>
              <SimulatedTag show={r.simulated} />
              {r.claimed ? <Tag>already claimed</Tag> : null}
            </button>
          ))}
        </section>
      ) : null}

      {google && onGoogle ? (
        <section className="space-y-2" aria-label="On Google Maps">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Eyebrow>On Google Maps</Eyebrow>
            <Tag>Places from Google Maps</Tag>
          </div>
          {onGoogle.length === 0 ? <Card className="text-sm text-muted">Nothing else on Google Maps by that name there.</Card> : null}
          {onGoogle.map((g) => (
            <div key={g.place.placeId} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-2.5 sm:flex-nowrap">
              {/* eslint-disable-next-line @next/next/no-img-element -- a map image from our API's Google proxy */}
              <img src={client.staticMapUrl(g.place.lat, g.place.lng)} alt="" width={128} height={72} className="h-18 w-32 shrink-0 rounded-xl bg-sunken object-cover" loading="lazy" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold">{g.place.name}</div>
                <div className="flex items-start gap-1 text-xs text-muted">
                  <MapPin className="mt-0.5 size-3 shrink-0" aria-hidden />
                  <span>
                    {g.place.kind ? `${g.place.kind} · ` : ''}
                    {g.place.address}
                  </span>
                </div>
                {g.place.mapsUrl ? (
                  <a href={g.place.mapsUrl} target="_blank" rel="noreferrer" className="link mt-1 inline-flex items-center gap-0.5 text-xs font-medium">
                    View on Google Maps
                    <ArrowUpRight className="size-3" aria-hidden />
                  </a>
                ) : null}
              </div>
              {g.claimed ? (
                <Tag>already claimed</Tag>
              ) : (
                <Button tone="secondary" busy={adding === g.place.placeId} disabled={!!adding} onClick={() => void addFromGoogle(g)} className="w-full sm:w-auto">
                  {g.listingId ? 'Claim' : 'Add and claim'}
                </Button>
              )}
            </div>
          ))}
        </section>
      ) : null}

      {picked ? (
        <div ref={how}>
          <Card className="space-y-4">
            <div className="font-semibold">How do you want to prove {picked.name} is yours?</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  aria-pressed={method === m.id}
                  className={`rounded-2xl border p-3 text-left text-sm transition-colors ${method === m.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong'}`}
                >
                  <div className="font-semibold">{m.label}</div>
                  <div className="text-muted">{m.detail}</div>
                </button>
              ))}
            </div>
            {method === 'domain' ? (
              <Field label="Domain">
                <input className={inputCls} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourcafe.in" />
              </Field>
            ) : null}
            {method === 'gst' ? (
              <Field label="GSTIN">
                <input className={inputCls} value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="30ABCDE1234F1Z5" />
              </Field>
            ) : null}
            <Button busy={busy} onClick={() => void start()} disabled={(method === 'domain' && !domain.trim()) || (method === 'gst' && gstin.trim().length !== 15)}>
              Start
            </Button>
          </Card>
        </div>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </div>
  );
}
