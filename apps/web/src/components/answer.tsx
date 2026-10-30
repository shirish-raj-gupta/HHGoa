'use client';

import Link from 'next/link';
import { ArrowUpRight, ReceiptText, Store } from 'lucide-react';
import type { Answer, AnswerOption } from '@receipts/client';
import { WEB_URL } from '@/lib/env';
import { EmptyState, ListenButton, RollingNumber, SpotlightCard, Stagger, StaggerItem, Stars, Tag, useSession } from '@receipts/react';

/** Receipt links come back absolute; keep them inside the app when they point here. */
export function receiptHref(url: string): string {
  return url.startsWith(WEB_URL) ? url.slice(WEB_URL.length) || '/' : url;
}

function pct(x: number | null) {
  return x === null ? null : `${Math.round(x * 100)}%`;
}

export function OptionCard({ option, rank, answerId, wallet }: { option: AnswerOption; rank: number; answerId?: string; wallet?: string | null }) {
  const price = option.price_paid_inr;
  // The click carries the answer (for attribution) and the buyer's wallet, so the purchase proof lands with them.
  const params = new URLSearchParams();
  if (answerId) params.set('a', answerId);
  if (wallet) params.set('w', wallet);
  const buy = option.buy_link ? `${option.buy_link}${params.size ? `?${params}` : ''}` : null;
  const top = rank === 1;
  return (
    <SpotlightCard className={`rounded-3xl border bg-surface shadow-card transition-shadow hover:shadow-lift ${top ? 'beam border-transparent' : 'border-line'}`}>
    <article className="relative space-y-4 p-5 sm:p-6">
      {top ? <span className="absolute -top-3 left-6 rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-brand-ink uppercase">Top pick</span> : null}
      <div className="flex items-start gap-4">
        <span className={`grid size-10 shrink-0 place-items-center rounded-2xl font-display text-lg font-bold ${top ? 'bg-accent text-accent-ink' : 'bg-sunken text-ink'}`}>{rank}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg leading-snug font-bold">{option.item}</h3>
          <Link href={`/m/${option.merchant_id}`} className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
            <Store className="size-3.5" aria-hidden />
            {option.merchant}
          </Link>
        </div>
        <div className="text-right">
          <div className="font-display text-3xl leading-none font-bold">
            <RollingNumber value={option.score} format={(n) => n.toFixed(1)} />
          </div>
          <div className="mt-1">
            <Stars value={option.score} size="text-xs" />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Tag tone="good">{option.verified_reviews} verified buyers</Tag>
        {price ? <Tag>{price.min === price.max ? `paid ₹${price.min}` : `paid ₹${price.min}–₹${price.max}`}</Tag> : null}
        {option.still_good_next_day !== null ? <Tag>{pct(option.still_good_next_day)} still good next day</Tag> : null}
        {option.durability !== null && option.still_good_next_day === null ? <Tag>{pct(option.durability)} durable</Tag> : null}
        {option.distance_km !== null ? <Tag>{option.distance_km.toFixed(1)} km</Tag> : null}
        {option.few_receipts ? <Tag tone="warn">few receipts so far</Tag> : null}
      </div>
      <ul className="space-y-2.5">
        {option.claims.map((c, i) => (
          <li key={`${i}:${c.text}`} className="border-l-2 border-brand-strong pl-3.5">
            <p className="font-serif text-[1.2rem] leading-snug italic">“{c.text}”</p>
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {c.receipts.slice(0, 3).map((r, i) => (
                <Link
                  key={r}
                  href={receiptHref(r)}
                  className="inline-flex min-h-7 items-center gap-1 rounded-full bg-sunken px-2.5 font-mono text-[11px] text-muted transition-colors hover:bg-accent-soft hover:text-ink"
                >
                  <ReceiptText className="size-3" aria-hidden />
                  receipt {i + 1}
                </Link>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {buy ? (
        <a href={buy} className="inline-flex items-center gap-1 text-sm font-semibold underline decoration-brand-strong decoration-2 underline-offset-4 hover:decoration-ink" rel="sponsored">
          Buy via Receipts
          <ArrowUpRight className="size-4" aria-hidden />
          <span className="ml-1 inline-block text-xs font-normal text-muted">(may earn Receipts a commission)</span>
        </a>
      ) : null}
    </article>
    </SpotlightCard>
  );
}

export function AnswerView({ answer, wallet }: { answer: Answer; wallet?: string | null }) {
  const { client, config } = useSession();
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-base leading-relaxed">{answer.summary}</p>
      {config?.speech?.on ? <ListenButton src={client.speechUrl('answers', answer.answer_id)} label="Listen to the answer" /> : null}
      {answer.not_enough_receipts ? (
        <EmptyState icon={<ReceiptText />} title="Not enough receipts yet">
          Nothing can be ranked for this until buyers review it. Bought one? Write the first review.
        </EmptyState>
      ) : (
        <Stagger className="grid gap-5 pt-2 lg:grid-cols-2">
          {answer.options.map((o, i) => (
            <StaggerItem key={o.item_id} className={i === 0 ? 'lg:col-span-2' : ''}>
              <OptionCard option={o} rank={i + 1} answerId={answer.answer_id} wallet={wallet} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
      <p className="max-w-3xl text-xs leading-relaxed text-muted">
        {answer.generated_by === 'llm' ? 'Written by a model from the receipts above; every claim links to its receipts.' : 'Quoted directly from the receipts above.'} {answer.disclosure}
      </p>
    </div>
  );
}
