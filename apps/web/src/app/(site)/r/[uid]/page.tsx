import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { CalendarCheck, ChevronDown, MapPin, MessageSquareQuote, ShieldCheck, Store } from 'lucide-react';
import { AspectTag, Card, Eyebrow, ExternalLink, ListenButton, Mono, SimulatedTag, Stars, Tag, VerifiedStamp } from '@receipts/react';
import { ShareButton } from '@/components/share-button';
import { VerifyPanel } from '@/components/verify-panel';
import { followupLabel } from '@/lib/format';
import { orNull, publicApi, serverClient } from '@/lib/server-api';

type Props = { params: Promise<{ uid: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { uid } = await params;
  const r = await orNull(serverClient.receipt(uid));
  if (!r) return { title: 'Receipt not found' };
  return {
    title: `${r.rating}★ ${r.item.name} at ${r.merchant.name}`,
    description: r.summary_en ?? r.claims.join(' · '),
    openGraph: { title: `${r.rating}★ ${r.item.name} at ${r.merchant.name} · verified purchase`, description: r.claims.join(' · ') },
  };
}

export default async function ReceiptPage({ params }: Props) {
  const { uid } = await params;
  const [r, config] = await Promise.all([orNull(serverClient.receipt(uid)), orNull(serverClient.config())]);
  if (!r) notFound();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>Receipt</Eyebrow>
        <ShareButton title={`${r.rating}★ ${r.item.name} at ${r.merchant.name}`} />
      </div>

      <article className="[filter:drop-shadow(0_18px_28px_rgb(var(--shadow-color)/0.14))]">
        <div className="perforated" />
        <div className="space-y-5 bg-surface px-5 pt-3 pb-6 sm:px-8">
          <div className="flex flex-wrap items-center gap-2">
            {r.simulated ? (
              <SimulatedTag />
            ) : (
              <>
                <VerifiedStamp />
                <Tag tone={r.reviewer.verifiedWith === 'mock' ? 'warn' : 'good'}>{r.reviewer.verifiedWith === 'mock' ? 'mock identity (rehearsal)' : 'unique human'}</Tag>
              </>
            )}
            {r.anchored ? <Tag tone="accent">on Base</Tag> : null}
            {r.status !== 'active' ? <Tag tone="warn">{r.status}</Tag> : null}
          </div>
          <div className="space-y-1.5">
            <h1 className="text-3xl leading-tight font-bold sm:text-4xl">{r.item.name}</h1>
            <Link href={`/m/${r.merchant.id}`} className="inline-flex items-center gap-1.5 text-muted transition-colors hover:text-ink">
              <Store className="size-4" aria-hidden />
              {r.merchant.name}
              {r.merchant.claimed ? <span className="text-xs">· claimed by the business</span> : null}
            </Link>
            {r.merchant.place.address ? (
              <p className="flex items-start gap-1.5 text-sm text-muted">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {r.merchant.place.address}
                  {r.merchant.place.mapsUrl ? (
                    <>
                      {' · '}
                      <ExternalLink href={r.merchant.place.mapsUrl}>Google Maps</ExternalLink>
                    </>
                  ) : null}
                </span>
              </p>
            ) : null}
            {r.merchant.place.fromGoogle && r.merchant.place.lat !== null && r.merchant.place.lng !== null ? (
              // eslint-disable-next-line @next/next/no-img-element -- a map image from our API's Google proxy
              <img
                src={publicApi.staticMapUrl(r.merchant.place.lat, r.merchant.place.lng)}
                alt={`Map of ${r.merchant.name}`}
                width={640}
                height={360}
                className="mt-2 aspect-video w-full rounded-2xl bg-sunken object-cover"
                loading="lazy"
              />
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <Stars value={r.rating} size="text-3xl" />
            <span className="font-display text-2xl font-bold tabular-nums">{r.rating}.0</span>
            {!r.hidden && config?.speech?.on ? <ListenButton src={publicApi.speechUrl('reviews', r.uid ?? r.id)} label="Listen" className="ml-auto" /> : null}
          </div>
          {r.hidden ? (
            <p className="text-sm text-muted">The text of this review is hidden ({r.hidden}). Its rating and proof still count.</p>
          ) : (
            <>
              {r.claims.length ? (
                <ul className="space-y-3">
                  {r.claims.map((c) => (
                    <li key={c} className="border-l-4 border-brand pl-4 font-serif text-2xl leading-snug italic sm:text-[1.75rem]">
                      “{c}”
                    </li>
                  ))}
                </ul>
              ) : null}
              {r.summary_en ? <p className="leading-relaxed text-muted">{r.summary_en}</p> : null}
              {Object.keys(r.aspects ?? {}).length ? (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(r.aspects).map(([k, v]) => (
                    <AspectTag key={k} name={k} value={v} />
                  ))}
                </div>
              ) : null}
              {r.transcript ? (
                <details className="group rounded-2xl bg-sunken text-sm">
                  <summary className="flex min-h-11 items-center gap-2 px-4 font-medium text-muted marker:content-none">
                    <MessageSquareQuote className="size-4" aria-hidden />
                    What they said{r.language ? ` (${r.language})` : ''}
                    <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="px-4 pb-4 leading-relaxed italic">“{r.transcript}”</p>
                </details>
              ) : null}
            </>
          )}
        </div>
        <div className="border-t-2 border-dashed border-line bg-sunken px-5 py-5 sm:px-8">
          <p className="mb-3 font-mono text-[11px] tracking-[0.2em] text-muted uppercase">Proof ledger</p>
          <dl className="divide-y divide-dashed divide-line font-mono text-xs">
            <Row k="Proof">
              {r.purchase.railLabel} · tier {r.purchase.tier} · proves {r.purchase.proves.toLowerCase()}
            </Row>
            <Row k="How">{r.purchase.how}</Row>
            <Row k="Bought">
              {r.purchase.purchased} · {r.purchase.brand}
            </Row>
            {r.purchase.rail === 'payment_proof' && r.merchant.place.fromGoogle ? (
              <Row k="Place">pinned by the reviewer on Google Maps; the payment proves who was paid, not where</Row>
            ) : null}
            <Row k="Proof hash">{r.purchase.proofHash}</Row>
            <Row k="Reviewer">
              {r.reviewer.id.slice(0, 14)}… · {r.reviewer.verifiedWith} · level {r.reviewer.level} · reliability {r.reviewer.reliability}
            </Row>
            <Row k="Attestation">{r.anchored ? <ExternalLink href={r.easUrl}>{r.uid}</ExternalLink> : 'not anchored on-chain'}</Row>
            {r.explorerTx ? (
              <Row k="Transaction">
                <ExternalLink href={r.explorerTx}>{r.txHash}</ExternalLink>
              </Row>
            ) : null}
            <Row k="Content">{r.contentCid}</Row>
            {r.purchase.trustAssumption ? <Row k="Assumes">{r.purchase.trustAssumption}</Row> : null}
          </dl>
        </div>
        <div className="perforated rotate-180 [--edge:var(--sunken)]" />
      </article>

      {r.followups.length ? (
        <Card className="space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <CalendarCheck className="size-5" aria-hidden />
            Later check-ins
          </h2>
          <ol className="space-y-3 border-l-2 border-line pl-5">
            {r.followups.map((f, i) => (
              <li key={i} className="relative flex flex-wrap items-center gap-2 text-sm">
                <span className={`absolute top-1.5 -left-[1.6rem] size-3 rounded-full ring-4 ring-surface ${f.answered_at ? (f.still_good ? 'bg-brand-strong' : 'bg-bad') : 'bg-line-strong'}`} aria-hidden />
                <Tag>{followupLabel(f.kind)}</Tag>
                {f.answered_at ? (
                  <span className="font-medium">
                    {f.still_good ? 'Still good' : 'Not good anymore'}
                    {f.new_rating ? ` · now ${f.new_rating}★` : ''}
                  </span>
                ) : (
                  <span className="text-muted">waiting for the reviewer</span>
                )}
                {f.easUrl ? <ExternalLink href={f.easUrl}>on-chain</ExternalLink> : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {r.replies.length ? (
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Store className="size-5" aria-hidden />
            Reply from {r.merchant.name}
          </h2>
          {r.replies.map((x, i) => (
            <div key={i} className="space-y-1.5 rounded-2xl bg-sunken p-4 text-sm">
              <p className="leading-relaxed">{x.text}</p>
              <p className="text-xs text-muted">
                Signed by the business’s verified wallet
                {x.easUrl ? (
                  <>
                    {' · '}
                    <ExternalLink href={x.easUrl}>attestation</ExternalLink>
                  </>
                ) : null}
              </p>
            </div>
          ))}
        </Card>
      ) : null}

      <Card className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-ink">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-bold">Check it yourself</h2>
            <p className="text-sm leading-relaxed text-muted">
              Re-verifies the purchase proof, the wallet binding, the one-review-per-purchase nullifier, the content hash, the attestation and the unique-human registry.
            </p>
          </div>
        </div>
        <VerifyPanel id={r.uid ?? r.id} />
      </Card>

      <p className="text-xs leading-relaxed text-muted">
        {r.disclosure}
        {r.commissionDisclosure ? ` ${r.commissionDisclosure}` : ''}
      </p>
    </div>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-2 sm:grid-cols-[8rem_1fr]">
      <dt className="text-muted uppercase">{k}</dt>
      <dd>
        <Mono className="text-xs!">{children}</Mono>
      </dd>
    </div>
  );
}
